import { describe, expect, test } from "bun:test";
import { asc } from "drizzle-orm";
import { addDays, Actions, periodBounds } from "../server/src/actions";
import * as schema from "../server/src/schema";
import { createTestDb, fakeCtx, todayLA } from "./helpers";
import { ALEX_ASPIRE, ALEX_BIZ_PLAT, JANUARY_SNAPSHOT } from "./fixtures/sample";

async function importJanuary(db: ReturnType<typeof createTestDb>) {
  return Actions.importSnapshot.handler(fakeCtx(db), structuredClone(JANUARY_SNAPSHOT) as any);
}

describe("importSnapshot — merge-only import", () => {
  test("first import adds accounts, seeds the catalog, and auto-maps postings", async () => {
    const db = createTestDb();
    const res: any = await importJanuary(db);
    expect(res.accountsAdded).toBe(2);
    expect(res.postingsAdded).toBe(4);
    expect(res.postingsSkipped).toBe(0);
    expect(res.existingPostingsPreserved).toBe(0);
    expect(res.dataCoverageStart).toBe("2026-01-01");

    // Catalog seeded from the card product: Aspire 2 credits, Business Platinum 5.
    const credits = await db.select().from(schema.credits);
    expect(credits).toHaveLength(7);

    // Postings auto-mapped by name pattern; the unrecognized one stays unassigned.
    const postings = await db
      .select()
      .from(schema.postings)
      .orderBy(asc(schema.postings.id));
    const creditName = new Map(credits.map((c) => [c.id, c.name]));
    const mapped = postings.map((p) => ({
      name: p.name,
      credit: p.creditId == null ? null : creditName.get(p.creditId),
    }));
    expect(mapped).toEqual([
      { name: "AMEX Flight Credit", credit: "Flight Credit" },
      { name: "Hilton", credit: "Hilton Resort Credit" },
      { name: "AMEX Airline Fee Reimbursement", credit: "Airline Fee Credit" },
      { name: "Mystery Statement Credit", credit: null },
    ]);
  });

  test("re-importing the identical snapshot adds nothing (dedup by transaction id)", async () => {
    const db = createTestDb();
    await importJanuary(db);
    const res: any = await importJanuary(db);
    expect(res.accountsAdded).toBe(0);
    expect(res.postingsAdded).toBe(0);
    expect(res.postingsSkipped).toBe(4);
    expect(res.existingPostingsPreserved).toBe(4);
    expect(res.dataCoverageStart).toBe("2026-01-01");

    const postings = await db.select().from(schema.postings);
    expect(postings).toHaveLength(4);
  });

  test("a later incremental import merges new postings and never moves coverage forward", async () => {
    const db = createTestDb();
    await importJanuary(db);
    const res: any = await Actions.importSnapshot.handler(fakeCtx(db), {
      windowStart: "2026-02-01",
      windowEnd: "2026-02-28",
      complete: true,
      accounts: [],
      postings: [
        {
          txnId: "fake-txn-flight-2",
          accountPlaidId: ALEX_ASPIRE.plaidAccountId,
          date: "2026-02-10",
          name: "AMEX Flight Credit",
          amount: 50,
        },
      ],
    });
    expect(res.postingsAdded).toBe(1);
    expect(res.existingPostingsPreserved).toBe(4);
    expect(res.dataCoverageStart).toBe("2026-01-01");
  });

  test("an incomplete import merges its postings but certifies NO coverage and does not mark lastImportAt", async () => {
    const db = createTestDb();
    await importJanuary(db);
    const before: any = await Actions.getDashboard.handler(fakeCtx(db), {});
    expect(before.lastImportAt).not.toBeNull();

    const res: any = await Actions.importSnapshot.handler(fakeCtx(db), {
      windowStart: "2025-07-01",
      windowEnd: "2025-07-31",
      complete: false, // truncated read: merges, but must not certify the window
      accounts: [],
      postings: [
        {
          txnId: "fake-txn-old-1",
          accountPlaidId: ALEX_ASPIRE.plaidAccountId,
          date: "2025-07-04",
          name: "AMEX Flight Credit",
          amount: 50,
        },
      ],
    });
    expect(res.postingsAdded).toBe(1);
    // Coverage stays at the certified Jan 1 even though the merged posting is older.
    expect(res.dataCoverageStart).toBe("2026-01-01");

    const after: any = await Actions.getDashboard.handler(fakeCtx(db), {});
    expect(after.lastImportAt).toBe(before.lastImportAt);
    expect(after.dataCoverageStart).toBe("2026-01-01");
  });

  test("a complete import over an earlier window extends coverage backwards", async () => {
    const db = createTestDb();
    await importJanuary(db);
    const res: any = await Actions.importSnapshot.handler(fakeCtx(db), {
      windowStart: "2025-01-01",
      windowEnd: "2025-12-31",
      complete: true,
      accounts: [],
      postings: [],
    });
    expect(res.dataCoverageStart).toBe("2025-01-01");
  });

  test("postings for unknown accounts are skipped, not stored", async () => {
    const db = createTestDb();
    const res: any = await Actions.importSnapshot.handler(fakeCtx(db), {
      complete: true,
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
      accounts: [],
      postings: [
        {
          txnId: "fake-txn-ghost",
          accountPlaidId: "fake-no-such-account",
          date: "2026-01-05",
          name: "AMEX Flight Credit",
          amount: 50,
        },
      ],
    });
    expect(res.postingsAdded).toBe(0);
    expect(res.postingsSkipped).toBe(1);
  });
});

describe("importSnapshot — duplicate account records are the user's decision", () => {
  // SEMANTICS CHANGED (fix package): import used to GUESS duplicates
  // (same name + balance + limit) and start the second record ignored.
  // That guess is gone: import NEVER auto-ignores. Lookalike records
  // are flagged `suspectedDuplicate` on the dashboard instead, stay
  // active and counted, and the user resolves them via setAccountIgnored.
  const aspire = (plaidAccountId: string, extra: Record<string, unknown> = {}) => ({
    plaidAccountId,
    name: "Hilton Honors Aspire Card",
    mask: "1111",
    balance: 300,
    creditLimit: 5000,
    owner: "A",
    ...extra,
  });

  async function importOne(db: ReturnType<typeof createTestDb>, account: unknown) {
    await Actions.importSnapshot.handler(fakeCtx(db), {
      complete: true,
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
      accounts: [account],
      postings: [],
    } as any);
    const rows = await db.select().from(schema.accounts);
    return rows.find((r) => r.plaidAccountId === (account as any).plaidAccountId)!;
  }

  test("a second record with the same name + balance + limit is NOT ignored — it is suspected on the dashboard", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    const first = await importOne(db, aspire("fake-dup-1"));
    const second = await importOne(db, aspire("fake-dup-2"));
    expect(first.ignored).toBe(0);
    expect(second.ignored).toBe(0); // never auto-ignored anymore

    const dash: any = await Actions.getDashboard.handler(ctx, {});
    const a1 = dash.accounts.find((a: any) => a.id === first.id);
    const a2 = dash.accounts.find((a: any) => a.id === second.id);
    // Same product + mask → both records are flagged as suspecting each
    // other, and both stay counted until the user decides.
    expect(a1.suspectedDuplicate).toBe(true);
    expect(a2.suspectedDuplicate).toBe(true);
    expect(a1.duplicateSuspectIds).toEqual([second.id]);
    expect(a2.duplicateSuspectIds).toEqual([first.id]);
    expect(dash.credits.filter((c: any) => c.name === "Flight Credit")).toHaveLength(2);
  });

  test("duplicates arriving in the SAME snapshot are not ignored either", async () => {
    const db = createTestDb();
    await Actions.importSnapshot.handler(fakeCtx(db), {
      complete: true,
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
      accounts: [aspire("fake-dup-a"), aspire("fake-dup-b")],
      postings: [],
    } as any);
    const rows = await db.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    expect(rows.map((r) => r.ignored)).toEqual([0, 0]);
  });

  test("balance and limit play no part: different balances are still only suspected, never ignored", async () => {
    const db = createTestDb();
    await importOne(db, aspire("fake-dup-1"));
    const diffBalance = await importOne(db, aspire("fake-dup-3", { balance: 301 }));
    expect(diffBalance.ignored).toBe(0);
    const diffLimit = await importOne(db, aspire("fake-dup-4", { creditLimit: 6000 }));
    expect(diffLimit.ignored).toBe(0);
  });

  test("a different mask is not suspected (two people can hold the same product)", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    await importOne(db, aspire("fake-mask-1"));
    await importOne(db, aspire("fake-mask-2", { mask: "2222" }));
    const dash: any = await Actions.getDashboard.handler(ctx, {});
    expect(dash.accounts.every((a: any) => a.suspectedDuplicate === false)).toBe(true);
  });

  test("a zero-balance twin is suspected by product + mask, still never ignored", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    await importOne(db, aspire("fake-zero-1", { balance: 0 }));
    const twin = await importOne(db, aspire("fake-zero-2", { balance: 0 }));
    expect(twin.ignored).toBe(0);
    const dash: any = await Actions.getDashboard.handler(ctx, {});
    expect(
      dash.accounts.find((a: any) => a.id === twin.id).suspectedDuplicate,
    ).toBe(true);
  });

  test("transaction evidence: the same txn id arriving under two records flags both as suspected", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    // The primary record under one login, then a supplementary view of
    // it under another login (different mask): the second snapshot
    // re-delivers a transaction id that is already stored under the
    // primary. That cross-account sighting is the transaction-subset
    // signature — one record's transactions are a subset of the
    // other's — and import records it as evidence (txn ids are globally
    // unique in the store, so the relation can only be observed here,
    // at import time, never recomputed from stored postings).
    await Actions.importSnapshot.handler(ctx, {
      complete: true,
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
      accounts: [aspire("fake-sub-primary")],
      postings: [
        { txnId: "fake-sub-t1", accountPlaidId: "fake-sub-primary", date: "2026-01-05", name: "AMEX Flight Credit", amount: 50 },
        { txnId: "fake-sub-t2", accountPlaidId: "fake-sub-primary", date: "2026-01-06", name: "AMEX Flight Credit", amount: 50 },
      ],
    } as any);
    await Actions.importSnapshot.handler(ctx, {
      complete: true,
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
      accounts: [aspire("fake-sub-au", { mask: "9999", owner: "B" })],
      postings: [
        { txnId: "fake-sub-t1", accountPlaidId: "fake-sub-au", date: "2026-01-05", name: "AMEX Flight Credit", amount: 50 },
      ],
    } as any);

    const evidence = await db.select().from(schema.accountDuplicateEvidence);
    expect(evidence).toHaveLength(1);
    const dash: any = await Actions.getDashboard.handler(ctx, {});
    const primary = dash.accounts.find((a: any) => a.mask === "1111");
    const au = dash.accounts.find((a: any) => a.mask === "9999");
    expect(primary.suspectedDuplicate).toBe(true);
    expect(au.suspectedDuplicate).toBe(true);
    expect(primary.duplicateSuspectIds).toEqual([au.id]);
    expect(au.duplicateSuspectIds).toEqual([primary.id]);
    // The evidence changes nothing by itself: both stay active/counted.
    expect(dash.accounts.every((a: any) => !a.ignored)).toBe(true);
  });

  test("an explicit ignored flag in the payload is honored (a curated user decision)", async () => {
    const db = createTestDb();
    const row = await importOne(db, aspire("fake-explicit-1", { balance: 999, ignored: true }));
    expect(row.ignored).toBe(1);
  });

  test("an account the user marked ignored is never un-ignored or flagged by later imports", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    const first = await importOne(db, aspire("fake-keep-1"));
    const second = await importOne(db, aspire("fake-keep-2"));
    await Actions.setAccountIgnored.handler(ctx, { accountId: second.id, ignored: true });
    // A later import of the same record must not resurrect it — not
    // even when the payload explicitly carries ignored: false (imports
    // may record an ignore, never lift one).
    await importOne(db, aspire("fake-keep-2", { ignored: false }));
    const rows = await db.select().from(schema.accounts);
    expect(rows.find((r) => r.id === second.id)!.ignored).toBe(1);
    // And with the pair resolved, the survivor is no longer suspected.
    const dash: any = await Actions.getDashboard.handler(ctx, {});
    expect(
      dash.accounts.find((a: any) => a.id === first.id).suspectedDuplicate,
    ).toBe(false);
  });
});

describe("importSnapshot — owner attribution is sticky", () => {
  const acct = (owner?: string) => ({
    plaidAccountId: "fake-sticky-1",
    name: "Hilton Honors Aspire Card",
    mask: "1111",
    balance: 10,
    creditLimit: 5000,
    ...(owner !== undefined ? { owner } : {}),
  });

  async function importAcct(db: ReturnType<typeof createTestDb>, account: unknown) {
    await Actions.importSnapshot.handler(fakeCtx(db), {
      complete: true,
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
      accounts: [account],
      postings: [],
    } as any);
    return (await db.select().from(schema.accounts))[0]!;
  }

  test("a later import never overwrites an existing owner", async () => {
    const db = createTestDb();
    await importAcct(db, acct("A"));
    // The refresh re-derives attribution differently (or wrongly): the
    // stored person must NOT flip.
    const after = await importAcct(db, acct("B"));
    expect(after.owner).toBe("A");
  });

  test("an import fills the owner only when the account has none yet", async () => {
    const db = createTestDb();
    const unset = await importAcct(db, acct());
    expect(unset.owner).toBeNull();
    const filled = await importAcct(db, acct("B"));
    expect(filled.owner).toBe("B");
  });
});

describe("importSnapshot — signed amounts (clawbacks) and strict dates", () => {
  test("a negative posting imports and nets against the credit it reverses", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    const today = todayLA();
    const quarter = periodBounds("quarterly", today);
    // Credit and its clawback land in the CURRENT quarter, so the
    // dashboard's current-period math must net them to zero.
    await Actions.importSnapshot.handler(ctx, {
      complete: true,
      windowStart: quarter.start,
      windowEnd: today,
      accounts: [ALEX_ASPIRE],
      postings: [
        { txnId: "fake-claw-credit", accountPlaidId: ALEX_ASPIRE.plaidAccountId, date: quarter.start, name: "AMEX Flight Credit", amount: 50 },
        { txnId: "fake-claw-reversal", accountPlaidId: ALEX_ASPIRE.plaidAccountId, date: addDays(quarter.start, 5), name: "AMEX Flight Credit", amount: -50 },
      ],
    } as any);
    const stored = await db.select().from(schema.postings);
    expect(stored.map((p) => p.amount).sort()).toEqual([-50, 50]);
    // The reversal matched the same credit by name, like any posting.
    expect(stored.every((p) => p.creditId != null)).toBe(true);
    expect(stored[0]!.creditId).toBe(stored[1]!.creditId);

    const dash: any = await Actions.getDashboard.handler(ctx, {});
    const flight = dash.credits.find((c: any) => c.name === "Flight Credit");
    expect(flight.currentPostings).toHaveLength(2);
    expect(flight.currentUsed).toBe(0);
    expect(flight.currentRemaining).toBe(50);
  });

  test("a partial clawback restores exactly the clawed-back part of the remaining", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    const today = todayLA();
    const half = periodBounds("semiannual", today);
    await Actions.importSnapshot.handler(ctx, {
      complete: true,
      windowStart: half.start,
      windowEnd: today,
      accounts: [ALEX_BIZ_PLAT],
      postings: [
        { txnId: "fake-claw-hotel", accountPlaidId: ALEX_BIZ_PLAT.plaidAccountId, date: half.start, name: "Platinum Hotel Credit", amount: 300 },
        { txnId: "fake-claw-hotel-back", accountPlaidId: ALEX_BIZ_PLAT.plaidAccountId, date: addDays(half.start, 9), name: "Platinum Hotel Credit", amount: -120 },
      ],
    } as any);
    const dash: any = await Actions.getDashboard.handler(ctx, {});
    const hotel = dash.credits.find((c: any) => c.name === "Hotel Credit (FHR / Hotel Collection)");
    expect(hotel.currentUsed).toBe(180);
    expect(hotel.currentRemaining).toBe(120);
  });

  test("impossible calendar dates are rejected, not rolled over", async () => {
    const db = createTestDb();
    await expect(
      Actions.importSnapshot.handler(fakeCtx(db), {
        complete: true,
        windowStart: "2026-01-01",
        windowEnd: "2026-01-31",
        accounts: [ALEX_ASPIRE],
        postings: [
          { txnId: "fake-bad-date", accountPlaidId: ALEX_ASPIRE.plaidAccountId, date: "2026-13-40", name: "AMEX Flight Credit", amount: 50 },
        ],
      } as any),
    ).rejects.toThrow();
    await expect(
      Actions.importSnapshot.handler(fakeCtx(db), {
        complete: true,
        windowStart: "2026-02-30",
        windowEnd: "2026-03-01",
        accounts: [],
        postings: [],
      } as any),
    ).rejects.toThrow();
    expect(await db.select().from(schema.postings)).toHaveLength(0);
  });

  test("the account's Plaid currency is stored on insert", async () => {
    const db = createTestDb();
    await Actions.importSnapshot.handler(fakeCtx(db), {
      complete: true,
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
      accounts: [{ ...ALEX_ASPIRE, currency: "USD" }],
      postings: [],
    } as any);
    const rows = await db.select().from(schema.accounts);
    expect(rows[0]!.currency).toBe("USD");
  });
});

describe("importSnapshot — seeded defaults are truthful, never assumed", () => {
  test("enrollment-required credits seed as NOT enrolled; automatic ones seed enrolled", async () => {
    const db = createTestDb();
    await Actions.importSnapshot.handler(fakeCtx(db), JANUARY_SNAPSHOT as any);
    const credits = await db.select().from(schema.credits);
    // Business Platinum's Hilton Credit requires Hilton for Business
    // enrollment — unknown state must not read as enrolled.
    const hilton = credits.find((c) => c.name === "Hilton Credit")!;
    expect(hilton.enrolled).toBe(0);
    // Airline Fee Credit is also enrollment-gated (airline selection).
    const airline = credits.find((c) => c.name === "Airline Fee Credit")!;
    expect(airline.enrolled).toBe(0);
    // Automatic credits keep the historical default.
    const flight = credits.find((c) => c.name === "Flight Credit")!;
    expect(flight.enrolled).toBe(1);
  });

  test("a catalog-default anchor seeds UNCONFIRMED; anchorless credits seed confirmed", async () => {
    const db = createTestDb();
    await Actions.importSnapshot.handler(fakeCtx(db), JANUARY_SNAPSHOT as any);
    const credits = await db.select().from(schema.credits);
    // The Aspire Resort Credit carries the placeholder May 1 anchor.
    const resort = credits.find((c) => c.name === "Hilton Resort Credit")!;
    expect(resort.anchorMonth).toBe(5);
    expect(resort.anchorConfirmed).toBe(0);
    const flight = credits.find((c) => c.name === "Flight Credit")!;
    expect(flight.anchorMonth).toBeNull();
    expect(flight.anchorConfirmed).toBe(1);
  });
});
