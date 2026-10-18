import { describe, expect, test } from "bun:test";
import { asc } from "drizzle-orm";
import { Actions } from "../server/src/actions";
import * as schema from "../server/src/schema";
import { createTestDb, fakeCtx } from "./helpers";

/**
 * Fifth-digit disambiguation, end to end. A household can hold several
 * cards of one product sharing a last-4 mask; the digit before the
 * last four (shown by issuers' apps as the five-digit ending) tells
 * them apart. The digit is user-owned state on the account: recorded
 * via updateAccount, never touched by imports, validated as a single
 * character 0-9 (or empty to clear), rendered into every payload
 * surface, and fed into the suspected-duplicate heuristic — which
 * compares effective endings and is scoped within one owner. All data
 * here is fictional (mask 6006, digits 2/7), like the rest of the
 * suite.
 */

const ASPIRE = "Hilton Honors Aspire Card";

const aspire = (plaidAccountId: string, owner: string, extra: Record<string, unknown> = {}) => ({
  plaidAccountId,
  name: ASPIRE,
  mask: "6006",
  balance: 100,
  creditLimit: 5000,
  owner,
  ...extra,
});

async function importAll(
  db: ReturnType<typeof createTestDb>,
  accounts: unknown[],
  postings: unknown[] = [],
) {
  const ctx = fakeCtx(db);
  await Actions.importSnapshot.handler(ctx, {
    complete: true,
    windowStart: "2026-01-01",
    windowEnd: "2026-10-31",
    accounts,
    postings,
  } as any);
  return ctx;
}

/** Two of owner A's Aspires + one of owner B's, all mask 6006. */
async function importTrio(db: ReturnType<typeof createTestDb>) {
  const ctx = await importAll(db, [
    aspire("fake-fd-a1", "A"),
    aspire("fake-fd-a2", "A"),
    aspire("fake-fd-b1", "B"),
  ]);
  const rows = await db
    .select()
    .from(schema.accounts)
    .orderBy(asc(schema.accounts.id));
  const byPlaid = new Map(rows.map((r) => [r.plaidAccountId, r]));
  return { ctx, a1: byPlaid.get("fake-fd-a1")!, a2: byPlaid.get("fake-fd-a2")!, b1: byPlaid.get("fake-fd-b1")! };
}

describe("fifth digit — storage and validation", () => {
  test("the digit is recorded via updateAccount, survives a re-import, and reaches the payload", async () => {
    const db = createTestDb();
    const { ctx, a1 } = await importTrio(db);
    expect(a1.fifthDigit).toBe(""); // imports never set it

    await Actions.updateAccount.handler(ctx, { accountId: a1.id, fifthDigit: "2" });

    // A Plaid re-import (which carries no digit) must not clear it,
    // while the fields imports own still refresh.
    await importAll(db, [aspire("fake-fd-a1", "A", { balance: 432 })]);
    const row = (await db.select().from(schema.accounts)).find((r) => r.id === a1.id)!;
    expect(row.fifthDigit).toBe("2");
    expect(row.balance).toBe(432);

    const dash: any = await Actions.getDashboard.handler(ctx, {});
    const acct = dash.accounts.find((a: any) => a.id === a1.id);
    expect(acct.fifthDigit).toBe("2");
    // The credit rows carry it too, so every surface can render the
    // five-digit ending; the untouched twin's rows carry "".
    const mine = dash.credits.filter((c: any) => c.accountId === a1.id);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((c: any) => c.fifthDigit === "2")).toBe(true);
    const twins = dash.credits.filter((c: any) => c.accountId !== a1.id);
    expect(twins.every((c: any) => c.fifthDigit === "")).toBe(true);
  });

  test("updateAccount rejects anything that is not a single digit, and empty clears", async () => {
    const db = createTestDb();
    const { ctx, a1 } = await importTrio(db);
    await expect(
      Actions.updateAccount.handler(ctx, { accountId: a1.id, fifthDigit: "x" }),
    ).rejects.toThrow("single digit 0-9");
    await expect(
      Actions.updateAccount.handler(ctx, { accountId: a1.id, fifthDigit: "12" }),
    ).rejects.toThrow("single digit 0-9");
    await expect(
      Actions.updateAccount.handler(ctx, { accountId: a1.id, fifthDigit: "-" }),
    ).rejects.toThrow("single digit 0-9");

    await Actions.updateAccount.handler(ctx, { accountId: a1.id, fifthDigit: "7" });
    expect((await db.select().from(schema.accounts)).find((r) => r.id === a1.id)!.fifthDigit).toBe("7");
    await Actions.updateAccount.handler(ctx, { accountId: a1.id, fifthDigit: "" });
    expect((await db.select().from(schema.accounts)).find((r) => r.id === a1.id)!.fifthDigit).toBe("");
  });
});

describe("fifth digit — suspected duplicates, end to end", () => {
  test("same-owner same-mask pair starts flagged; different digits unflag it; the same digit re-flags it", async () => {
    const db = createTestDb();
    const { ctx, a1, a2, b1 } = await importTrio(db);
    const flags = async () => {
      const dash: any = await Actions.getDashboard.handler(ctx, {});
      const get = (id: number) => dash.accounts.find((a: any) => a.id === id);
      return { a1: get(a1.id), a2: get(a2.id), b1: get(b1.id) };
    };

    // Same product + mask + owner → flagged as each other's suspect.
    // The spouse's identical card (different owner) is never flagged.
    let f = await flags();
    expect(f.a1.suspectedDuplicate).toBe(true);
    expect(f.a2.suspectedDuplicate).toBe(true);
    expect(f.a1.duplicateSuspectIds).toEqual([a2.id]);
    expect(f.a2.duplicateSuspectIds).toEqual([a1.id]);
    expect(f.b1.suspectedDuplicate).toBe(false);
    expect(f.b1.duplicateSuspectIds).toEqual([]);

    // Different fifth digits → demonstrably different cards → unflagged.
    await Actions.updateAccount.handler(ctx, { accountId: a1.id, fifthDigit: "2" });
    await Actions.updateAccount.handler(ctx, { accountId: a2.id, fifthDigit: "7" });
    f = await flags();
    expect(f.a1.suspectedDuplicate).toBe(false);
    expect(f.a2.suspectedDuplicate).toBe(false);
    expect(f.b1.suspectedDuplicate).toBe(false);

    // The SAME digit on both → effective endings still agree → flagged.
    await Actions.updateAccount.handler(ctx, { accountId: a2.id, fifthDigit: "2" });
    f = await flags();
    expect(f.a1.suspectedDuplicate).toBe(true);
    expect(f.a2.suspectedDuplicate).toBe(true);
  });
});

describe("fifth digit — disambiguation evidence on the payload", () => {
  test("same-ending accounts of one owner carry their fee + recent postings; other accounts carry none", async () => {
    const db = createTestDb();
    const ctx = await importAll(
      db,
      [aspire("fake-fd-a1", "A"), aspire("fake-fd-a2", "A"), aspire("fake-fd-b1", "B")],
      [
        // a1: a membership-fee posting plus four credit postings.
        { txnId: "fake-fd-fee-1", accountPlaidId: "fake-fd-a1", date: "2026-03-02", name: "RENEWAL MEMBERSHIP FEE", amount: 495 },
        { txnId: "fake-fd-p1", accountPlaidId: "fake-fd-a1", date: "2026-01-20", name: "Hilton", amount: 50 },
        { txnId: "fake-fd-p2", accountPlaidId: "fake-fd-a1", date: "2026-04-20", name: "Hilton", amount: 50 },
        { txnId: "fake-fd-p3", accountPlaidId: "fake-fd-a1", date: "2026-07-20", name: "Hilton", amount: 50 },
        { txnId: "fake-fd-p4", accountPlaidId: "fake-fd-a1", date: "2026-10-05", name: "Hilton", amount: 50 },
        // a2: its own fee posting on a different date.
        { txnId: "fake-fd-fee-2", accountPlaidId: "fake-fd-a2", date: "2026-06-11", name: "RENEWAL MEMBERSHIP FEE", amount: 550 },
      ],
    );

    const dash: any = await Actions.getDashboard.handler(ctx, {});
    const rows = await db.select().from(schema.accounts).orderBy(asc(schema.accounts.id));
    const byPlaid = new Map(rows.map((r) => [r.plaidAccountId, r.id]));
    const get = (plaid: string) => dash.accounts.find((a: any) => a.id === byPlaid.get(plaid));

    const d1 = get("fake-fd-a1").disambiguation;
    expect(d1).not.toBeNull();
    expect(d1.annualFeePosting).toEqual({
      date: "2026-03-02",
      name: "RENEWAL MEMBERSHIP FEE",
      amount: 495,
    });
    // The three most recent postings, newest first, fee not repeated.
    expect(d1.recentPostings.map((p: any) => p.date)).toEqual([
      "2026-10-05",
      "2026-07-20",
      "2026-04-20",
    ]);

    const d2 = get("fake-fd-a2").disambiguation;
    expect(d2.annualFeePosting).toEqual({
      date: "2026-06-11",
      name: "RENEWAL MEMBERSHIP FEE",
      amount: 550,
    });

    // The spouse's card shares the mask but not the owner: it stands
    // alone, needs no digit, and gets no disambiguation block.
    expect(get("fake-fd-b1").disambiguation).toBeNull();
  });
});
