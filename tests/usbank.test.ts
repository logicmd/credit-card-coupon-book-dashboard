import { describe, expect, test } from "bun:test";
import {
  addDays,
  Actions,
  catalogFor,
  enrollmentInfoFor,
  issuerForAccountName,
  matchCreditForPosting,
  periodBounds,
} from "../server/src/actions";
import * as schema from "../server/src/schema";
import { createTestDb, fakeCtx, todayLA } from "./helpers";
import { ALEX_ALTITUDE_RESERVE } from "./fixtures/sample";

// End-to-end coverage for the U.S. Bank side of the catalog: a fictional
// Altitude Reserve imports with issuer "U.S. Bank", seeds its one
// anniversary-anchored credit, and accrues usage from the bank's many
// small "Annual Travel/dining Credit" postings. All ids/masks/amounts
// invented.
//
// Identification caveat this suite pins down: U.S. Bank usually reports
// a GENERIC Plaid account name ("Credit Card - 7536"), which matches no
// catalog on purpose — a generic name must never guess a product. The
// fixture's name carries the product (some reads do); generically named
// accounts are identified by evidence ($400 annual fee + the credit
// postings) during setup and get their row from this same definition.

const MAY_1 = { month: 5, day: 1 };
const POSTING_NAME = "Annual Travel/dining Credit (up To $325)";

describe("Altitude Reserve — catalog definition", () => {
  test("the $325 travel/dining credit, annual on a May 1 placeholder anchor", () => {
    const defs = catalogFor("U.S. Bank Altitude® Reserve Visa Infinite® Card")!;
    expect(defs).toEqual([
      expect.objectContaining({
        name: "Travel/Dining Credit",
        amount: 325,
        period: "annual",
        anchorMonth: 5,
        anchorDay: 1,
        pattern: "travel/dining credit",
      }),
    ]);
    // Automatic reimbursement — no enrollment step.
    expect(defs[0]!.enrollmentRequired).toBeUndefined();
    expect(
      enrollmentInfoFor(
        "U.S. Bank Altitude® Reserve Visa Infinite® Card",
        "Travel/Dining Credit",
      ),
    ).toEqual({ required: false, note: null });
  });

  test("issuer detection knows U.S. Bank", () => {
    expect(
      issuerForAccountName("U.S. Bank Altitude® Reserve Visa Infinite® Card"),
    ).toBe("U.S. Bank");
  });

  test("a generic U.S. Bank account name matches NO catalog (identification is by evidence, not by guessing)", () => {
    expect(catalogFor("Credit Card - 7536")).toBeNull();
    // Other U.S. Bank products are not supported either.
    expect(catalogFor("U.S. Bank Cash+® Visa Signature® Card")).toBeNull();
  });

  test("the pattern matches the bank's postings but never Real-time Rewards redemptions", () => {
    const defs = catalogFor("U.S. Bank Altitude® Reserve Visa Infinite® Card")!;
    const credits = defs.map((d) => ({ matchPattern: d.pattern }));
    expect(matchCreditForPosting(credits, POSTING_NAME)).toBeDefined();
    // Real-time Rewards postings are points redemptions, not this credit.
    expect(matchCreditForPosting(credits, "Real-time Rewards Credit")).toBeUndefined();
  });
});

async function importAltitude(
  db: ReturnType<typeof createTestDb>,
  postings: { txnId: string; date: string; name: string; amount: number }[],
) {
  const today = todayLA();
  const anniversary = periodBounds("annual", today, MAY_1);
  return Actions.importSnapshot.handler(fakeCtx(db), {
    complete: true,
    windowStart: addDays(anniversary.start, -30),
    windowEnd: today,
    accounts: [ALEX_ALTITUDE_RESERVE],
    postings: postings.map((p) => ({
      ...p,
      accountPlaidId: ALEX_ALTITUDE_RESERVE.plaidAccountId,
    })),
  } as any);
}

describe("Altitude Reserve import — issuer, seeding, anchored accrual", () => {
  test("small travel/dining postings sum against the $325 cap in the anchored cardmember year", async () => {
    const db = createTestDb();
    const today = todayLA();
    const anniversary = periodBounds("annual", today, MAY_1);
    await importAltitude(db, [
      // Three small reimbursements in the current cardmember year.
      { txnId: "fake-txn-usb-td-1", date: anniversary.start, name: POSTING_NAME, amount: 42.5 },
      { txnId: "fake-txn-usb-td-2", date: addDays(anniversary.start, 40), name: POSTING_NAME, amount: 18.25 },
      { txnId: "fake-txn-usb-td-3", date: addDays(anniversary.start, 80), name: POSTING_NAME, amount: 77.05 },
      // Last cardmember year's usage: mapped, but not this period's.
      { txnId: "fake-txn-usb-td-prev", date: addDays(anniversary.start, -15), name: POSTING_NAME, amount: 200 },
      // A points redemption in the current period: NOT this credit.
      { txnId: "fake-txn-usb-rtr", date: addDays(anniversary.start, 10), name: "Real-time Rewards Credit", amount: 60 },
    ]);

    const accounts = await db.select().from(schema.accounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.issuer).toBe("U.S. Bank");

    const credits = await db.select().from(schema.credits);
    expect(credits).toHaveLength(1);
    expect(credits[0]).toEqual(
      expect.objectContaining({
        name: "Travel/Dining Credit",
        amount: 325,
        period: "annual",
        anchorMonth: 5,
        anchorDay: 1,
        // The catalog anchor is a placeholder: seeded unconfirmed, to
        // be corrected to the card's annual-fee date during setup.
        anchorConfirmed: 0,
        matchPattern: "travel/dining credit",
      }),
    );

    const dash: any = await Actions.getDashboard.handler(fakeCtx(db), {});
    const acct = dash.accounts.find((a: any) => a.mask === "4321");
    expect(acct.issuer).toBe("U.S. Bank");

    const credit = dash.credits.find((c: any) => c.name === "Travel/Dining Credit");
    expect(credit.periodStart).toBe(anniversary.start);
    expect(credit.periodEnd).toBe(anniversary.end);
    expect(credit.periodLabel).toBe(anniversary.label);
    // 42.50 + 18.25 + 77.05 — the previous year's $200 does not leak in.
    expect(credit.currentUsed).toBe(137.8);
    expect(credit.currentRemaining).toBe(187.2);
    expect(credit.currentPostings).toHaveLength(3);

    // The Real-time Rewards redemption is the one unassigned posting.
    expect(dash.unassigned).toHaveLength(1);
    expect(dash.unassigned[0].name).toBe("Real-time Rewards Credit");
  });

  test("postings that reach exactly $325 exhaust the credit for the year", async () => {
    const db = createTestDb();
    const today = todayLA();
    const anniversary = periodBounds("annual", today, MAY_1);
    await importAltitude(db, [
      { txnId: "fake-txn-usb-cap-1", date: anniversary.start, name: POSTING_NAME, amount: 150 },
      { txnId: "fake-txn-usb-cap-2", date: addDays(anniversary.start, 30), name: POSTING_NAME, amount: 125.5 },
      { txnId: "fake-txn-usb-cap-3", date: addDays(anniversary.start, 60), name: POSTING_NAME, amount: 49.5 },
    ]);

    const dash: any = await Actions.getDashboard.handler(fakeCtx(db), {});
    const credit = dash.credits.find((c: any) => c.name === "Travel/Dining Credit");
    expect(credit.currentUsed).toBe(325);
    expect(credit.currentRemaining).toBe(0);
    expect(dash.unassigned).toHaveLength(0);
  });
});
