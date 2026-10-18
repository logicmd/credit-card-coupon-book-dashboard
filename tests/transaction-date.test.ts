import { describe, expect, test } from "bun:test";
import { addDays, Actions, periodBounds, transactionDateOf } from "../server/src/actions";
import * as schema from "../server/src/schema";
import { createTestDb, fakeCtx, todayLA } from "./helpers";
import { ALEX_ASPIRE } from "./fixtures/sample";

// Feature: postings carry a TRANSACTION date (Plaid authorized_date) and a
// POSTED date. Period bucketing uses the transaction date; the posted date
// is display-only. Dates here are anchored to the CURRENT quarter (via the
// helpers) so the dashboard's current-period math is deterministic whenever
// the suite runs — plus one literal spec example below.

describe("transactionDateOf", () => {
  test("prefers the transaction date, falls back to the posted date", () => {
    expect(transactionDateOf({ date: "2026-10-02", transactionDate: "2026-09-30" })).toBe("2026-09-30");
    expect(transactionDateOf({ date: "2026-10-02", transactionDate: null })).toBe("2026-10-02");
    expect(transactionDateOf({ date: "2026-10-02" })).toBe("2026-10-02");
  });

  test("the spec example: authorized Sep 30 / posted Oct 2 buckets into Q3, not Q4", () => {
    const q3 = periodBounds("quarterly", "2026-09-30");
    const q4 = periodBounds("quarterly", "2026-10-02");
    expect(q3.key).toBe("2026-Q3");
    expect(q4.key).toBe("2026-Q4");
    const eff = transactionDateOf({ date: "2026-10-02", transactionDate: "2026-09-30" });
    expect(eff >= q3.start && eff <= q3.end).toBe(true);
    expect(eff >= q4.start && eff <= q4.end).toBe(false);
  });
});

describe("importSnapshot — transaction-date attribution", () => {
  const today = todayLA();
  const quarter = periodBounds("quarterly", today);
  // Transaction authorized on the LAST day of last quarter, posted on the
  // SECOND day of this quarter: by transaction date it belongs to last
  // quarter, so this quarter's Flight Credit must show it as NOT used.
  const txnLastQuarter = addDays(quarter.start, -1);
  const postedThisQuarter = addDays(quarter.start, 1);

  function snapshot(txnDate: string | undefined, postedDate: string) {
    return {
      complete: true,
      windowStart: addDays(quarter.start, -10),
      windowEnd: today,
      accounts: [ALEX_ASPIRE],
      postings: [
        {
          txnId: "fake-txn-td-flight",
          accountPlaidId: ALEX_ASPIRE.plaidAccountId,
          date: postedDate,
          ...(txnDate !== undefined ? { transactionDate: txnDate } : {}),
          name: "Hilton",
          amount: 50,
        },
      ],
    };
  }

  async function flightCredit(db: ReturnType<typeof createTestDb>) {
    const dash: any = await Actions.getDashboard.handler(fakeCtx(db), {});
    return dash.credits.find((c: any) => c.name === "Flight Credit");
  }

  test("a posting authorized last quarter but posted this quarter counts in last quarter", async () => {
    const db = createTestDb();
    const res: any = await Actions.importSnapshot.handler(
      fakeCtx(db),
      structuredClone(snapshot(txnLastQuarter, postedThisQuarter)) as any,
    );
    expect(res.postingsAdded).toBe(1);
    expect(res.postingsCorrected).toBe(0);

    // Both dates are stored: posted in `date`, transaction in `transactionDate`.
    const rows = await db.select().from(schema.postings);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe(postedThisQuarter);
    expect(rows[0]!.transactionDate).toBe(txnLastQuarter);

    // This quarter's flight credit is untouched (the posting counts in Q-1).
    const flight = await flightCredit(db);
    expect(flight.currentUsed).toBe(0);
    expect(flight.currentRemaining).toBe(50);
    expect(flight.currentPostings).toHaveLength(0);
  });

  test("when transactionDate is absent, bucketing falls back to the posted date", async () => {
    const db = createTestDb();
    await Actions.importSnapshot.handler(
      fakeCtx(db),
      structuredClone(snapshot(undefined, postedThisQuarter)) as any,
    );
    const rows = await db.select().from(schema.postings);
    expect(rows[0]!.transactionDate).toBeNull();
    const flight = await flightCredit(db);
    expect(flight.currentUsed).toBe(50); // posted this quarter → counts this quarter
  });

  test("re-import with a corrected transactionDate fixes the stored date in place and moves the bucket", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    await Actions.importSnapshot.handler(
      ctx,
      structuredClone(snapshot(txnLastQuarter, postedThisQuarter)) as any,
    );
    expect((await flightCredit(db)).currentUsed).toBe(0);

    // Plaid now reports the authorization inside THIS quarter instead.
    const res: any = await Actions.importSnapshot.handler(
      ctx,
      structuredClone(snapshot(quarter.start, postedThisQuarter)) as any,
    );
    expect(res.postingsAdded).toBe(0);
    expect(res.postingsCorrected).toBe(1);
    expect(res.postingsSkipped).toBe(0);

    // Still exactly one posting row — corrected, not duplicated.
    const rows = await db.select().from(schema.postings);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.transactionDate).toBe(quarter.start);

    // And the bucket moved: this quarter now shows the credit as used, with
    // both dates exposed for display (transaction date primary).
    const flight = await flightCredit(db);
    expect(flight.currentUsed).toBe(50);
    expect(flight.currentPostings).toHaveLength(1);
    expect(flight.currentPostings[0].date).toBe(quarter.start);
    expect(flight.currentPostings[0].postedDate).toBe(postedThisQuarter);
  });

  test("re-import with no transactionDate never 'corrects' anything", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    await Actions.importSnapshot.handler(
      ctx,
      structuredClone(snapshot(txnLastQuarter, postedThisQuarter)) as any,
    );
    const res: any = await Actions.importSnapshot.handler(
      ctx,
      structuredClone(snapshot(undefined, postedThisQuarter)) as any,
    );
    expect(res.postingsAdded).toBe(0);
    expect(res.postingsCorrected).toBe(0);
    expect(res.postingsSkipped).toBe(1);
    const rows = await db.select().from(schema.postings);
    expect(rows[0]!.transactionDate).toBe(txnLastQuarter);
  });
});
