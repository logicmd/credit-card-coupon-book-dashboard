import { describe, expect, test } from "bun:test";
import { asc } from "drizzle-orm";
import { Actions } from "../server/src/actions";
import * as schema from "../server/src/schema";
import { createTestDb, fakeCtx } from "./helpers";
import { ALEX_ASPIRE, JANUARY_SNAPSHOT } from "./fixtures/sample";

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

describe("importSnapshot — duplicate account records", () => {
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

  test("a second record with the same name + balance + limit starts ignored", async () => {
    const db = createTestDb();
    const first = await importOne(db, aspire("fake-dup-1"));
    expect(first.ignored).toBe(0);
    const second = await importOne(db, aspire("fake-dup-2"));
    expect(second.ignored).toBe(1);
  });

  test("duplicates arriving in the SAME snapshot are also flagged", async () => {
    const db = createTestDb();
    await Actions.importSnapshot.handler(fakeCtx(db), {
      complete: true,
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
      accounts: [aspire("fake-dup-a"), aspire("fake-dup-b")],
      postings: [],
    } as any);
    const rows = await db.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    expect(rows.map((r) => r.ignored)).toEqual([0, 1]);
  });

  test("different balance or different limit is NOT a duplicate", async () => {
    const db = createTestDb();
    await importOne(db, aspire("fake-dup-1"));
    const diffBalance = await importOne(db, aspire("fake-dup-3", { balance: 301 }));
    expect(diffBalance.ignored).toBe(0);
    const diffLimit = await importOne(db, aspire("fake-dup-4", { creditLimit: 6000 }));
    expect(diffLimit.ignored).toBe(0);
  });

  test("a zero-balance twin is never auto-flagged (balance must be non-zero)", async () => {
    const db = createTestDb();
    await importOne(db, aspire("fake-zero-1", { balance: 0 }));
    const twin = await importOne(db, aspire("fake-zero-2", { balance: 0 }));
    expect(twin.ignored).toBe(0);
  });

  test("an explicit ignored flag in the payload wins", async () => {
    const db = createTestDb();
    const row = await importOne(db, aspire("fake-explicit-1", { balance: 999, ignored: true }));
    expect(row.ignored).toBe(1);
  });
});
