import { describe, expect, test } from "bun:test";
import { Actions, addDays } from "../server/src/actions";
import * as schema from "../server/src/schema";
import { createTestDb, fakeCtx, todayLA } from "./helpers";
import { ALEX_ASPIRE, ALEX_BIZ_GOLD, SAM_ASPIRE } from "./fixtures/sample";

/**
 * Fix-package behavior around synthesized (negative-id) credits and
 * per-account user settings:
 *  - materialize-on-write: acting on a synthesized instance creates its
 *    stored row first, so edits / enrolled toggles / deletions stick;
 *  - deletion is a tombstone: a deleted stored catalog credit must NOT
 *    be resurrected by compute-time synthesis;
 *  - assignPosting validates its target;
 *  - account nicknames (display prefixes) are user-owned and survive
 *    re-imports;
 *  - listUnassignedCount agrees with the dashboard by construction.
 */

async function importAccounts(
  db: ReturnType<typeof createTestDb>,
  accounts: unknown[],
  postings: unknown[] = [],
) {
  const ctx = fakeCtx(db);
  await Actions.importSnapshot.handler(ctx, {
    complete: true,
    windowStart: "2026-01-01",
    windowEnd: todayLA(),
    accounts,
    postings,
  } as any);
  return ctx;
}

/** Show the default-hidden ChatGPT family so its synthesized instance is visible. */
async function unhideChatgpt(ctx: any) {
  await Actions.setExcludedCredits.handler(ctx, {
    excludedCredits: ["indeed", "adobe", "clear", "equinox", "entertainment", "walmart", "global entry", "farelock"],
  });
}

describe("materialize-on-write — synthesized credits", () => {
  test("editing a synthesized credit persists across reads", async () => {
    const db = createTestDb();
    const ctx = await importAccounts(db, [ALEX_BIZ_GOLD]);
    await unhideChatgpt(ctx);
    const dash1: any = await Actions.getDashboard.handler(ctx, {});
    const chat = dash1.credits.find((c: any) => c.name === "ChatGPT Business Credit");
    expect(chat.id).toBeLessThan(0); // synthesized, no stored row yet

    await Actions.updateCredit.handler(ctx, { id: chat.id, note: "Enrolled 2026-10-01" });
    const rows = await db.select().from(schema.credits);
    const stored = rows.find((r) => r.name === "ChatGPT Business Credit")!;
    expect(stored).toBeDefined();
    expect(stored.note).toBe("Enrolled 2026-10-01");

    const dash2: any = await Actions.getDashboard.handler(ctx, {});
    const after = dash2.credits.find((c: any) => c.name === "ChatGPT Business Credit");
    expect(after.id).toBe(stored.id); // now the stored row, no longer synthesized
    expect(after.note).toBe("Enrolled 2026-10-01");
  });

  test("marking a synthesized enrollment-required credit enrolled persists (and starts un-enrolled)", async () => {
    const db = createTestDb();
    const ctx = await importAccounts(db, [ALEX_BIZ_GOLD]);
    await unhideChatgpt(ctx);
    const dash1: any = await Actions.getDashboard.handler(ctx, {});
    const chat = dash1.credits.find((c: any) => c.name === "ChatGPT Business Credit");
    expect(chat.id).toBeLessThan(0);
    // Never assume enrollment: a synthesized instance of an
    // enrollment-required def starts NOT enrolled.
    expect(chat.enrolled).toBe(false);

    await Actions.updateCredit.handler(ctx, { id: chat.id, enrolled: true });
    const dash2: any = await Actions.getDashboard.handler(ctx, {});
    const after = dash2.credits.find((c: any) => c.name === "ChatGPT Business Credit");
    expect(after.id).toBeGreaterThan(0);
    expect(after.enrolled).toBe(true);
  });

  test("deleting a synthesized credit keeps it deleted", async () => {
    const db = createTestDb();
    const ctx = await importAccounts(db, [ALEX_BIZ_GOLD]);
    await unhideChatgpt(ctx);
    const dash1: any = await Actions.getDashboard.handler(ctx, {});
    const chat = dash1.credits.find((c: any) => c.name === "ChatGPT Business Credit");
    await Actions.deleteCredit.handler(ctx, { id: chat.id });

    const dash2: any = await Actions.getDashboard.handler(ctx, {});
    expect(dash2.credits.map((c: any) => c.name)).not.toContain("ChatGPT Business Credit");
    const stored = (await db.select().from(schema.credits)).find(
      (r) => r.name === "ChatGPT Business Credit",
    )!;
    expect(stored.deleted).toBe(1);
  });

  test("deleting a STORED catalog credit does not resurrect it via synthesis", async () => {
    const db = createTestDb();
    const ctx = await importAccounts(db, [ALEX_ASPIRE]);
    // Flight Credit is seeded at import (a stored row).
    const stored = (await db.select().from(schema.credits)).find(
      (r) => r.name === "Flight Credit",
    )!;
    await Actions.deleteCredit.handler(ctx, { id: stored.id });

    const dash: any = await Actions.getDashboard.handler(ctx, {});
    expect(dash.credits.map((c: any) => c.name)).not.toContain("Flight Credit");
    // And it stays gone after a re-import too.
    await importAccounts(db, [ALEX_ASPIRE]);
    const dash2: any = await Actions.getDashboard.handler(ctx, {});
    expect(dash2.credits.map((c: any) => c.name)).not.toContain("Flight Credit");
  });

  test("stop-tracking a hidden-then-shown family member sticks", async () => {
    const db = createTestDb();
    const ctx = await importAccounts(db, [ALEX_BIZ_GOLD]);
    // ChatGPT starts hidden by the default exclusion list; show it.
    await unhideChatgpt(ctx);
    const dash1: any = await Actions.getDashboard.handler(ctx, {});
    const chat = dash1.credits.find((c: any) => c.name === "ChatGPT Business Credit");
    expect(chat).toBeDefined();

    await Actions.updateCredit.handler(ctx, { id: chat.id, active: false });
    const dash2: any = await Actions.getDashboard.handler(ctx, {});
    const after = dash2.credits.find((c: any) => c.name === "ChatGPT Business Credit");
    expect(after.active).toBe(false);
    expect(dash2.totals.openCredits).toBe(dash1.totals.openCredits - 1);
  });

  test("re-adding a deleted credit revives its tombstone instead of duplicating it", async () => {
    const db = createTestDb();
    const ctx = await importAccounts(db, [ALEX_ASPIRE]);
    const acct = (await db.select().from(schema.accounts))[0]!;
    const stored = (await db.select().from(schema.credits)).find(
      (r) => r.name === "Flight Credit",
    )!;
    await Actions.deleteCredit.handler(ctx, { id: stored.id });
    const res: any = await Actions.addCredit.handler(ctx, {
      accountId: acct.id,
      name: "Flight Credit",
      amount: 50,
      period: "quarterly",
      note: "",
      matchPattern: "",
    });
    expect(res.id).toBe(stored.id);
    const rows = (await db.select().from(schema.credits)).filter(
      (r) => r.name === "Flight Credit",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deleted).toBe(0);
    const dash: any = await Actions.getDashboard.handler(ctx, {});
    expect(dash.credits.map((c: any) => c.name)).toContain("Flight Credit");
  });

  test("acting on a nonexistent credit id is an error, not a silent no-op", async () => {
    const db = createTestDb();
    const ctx = await importAccounts(db, [ALEX_ASPIRE]);
    await expect(
      Actions.updateCredit.handler(ctx, { id: 424242, note: "x" } as any),
    ).rejects.toThrow("not found");
    await expect(
      Actions.deleteCredit.handler(ctx, { id: 424242 } as any),
    ).rejects.toThrow("not found");
  });
});

describe("assignPosting — target validation", () => {
  test("assigning to a credit on another account, or a nonexistent one, errors", async () => {
    const db = createTestDb();
    const ctx = await importAccounts(db, [ALEX_ASPIRE, SAM_ASPIRE], [
      {
        txnId: "fake-assign-1",
        accountPlaidId: ALEX_ASPIRE.plaidAccountId,
        date: todayLA(),
        name: "Some Unmatched Credit",
        amount: 10,
      },
    ]);
    const posting = (await db.select().from(schema.postings))[0]!;
    const samFlight = (await db.select().from(schema.credits)).find(
      (r) => r.name === "Flight Credit" && r.accountId !== posting.accountId,
    )!;
    await expect(
      Actions.assignPosting.handler(ctx, { postingId: posting.id, creditId: samFlight.id }),
    ).rejects.toThrow("different account");
    await expect(
      Actions.assignPosting.handler(ctx, { postingId: posting.id, creditId: 987654 }),
    ).rejects.toThrow("not found");
    // The posting is still unassigned — no dangling reference was written.
    const after = (await db.select().from(schema.postings))[0]!;
    expect(after.creditId).toBeNull();
  });

  test("assigning to a synthesized credit materializes it and sticks", async () => {
    const db = createTestDb();
    const ctx = await importAccounts(db, [ALEX_BIZ_GOLD], [
      {
        txnId: "fake-assign-2",
        accountPlaidId: ALEX_BIZ_GOLD.plaidAccountId,
        date: todayLA(),
        name: "Some Unmatched Credit",
        amount: 10,
      },
    ]);
    await unhideChatgpt(ctx);
    const dash1: any = await Actions.getDashboard.handler(ctx, {});
    const chat = dash1.credits.find((c: any) => c.name === "ChatGPT Business Credit");
    expect(chat.id).toBeLessThan(0);
    const posting = (await db.select().from(schema.postings))[0]!;
    await Actions.assignPosting.handler(ctx, { postingId: posting.id, creditId: chat.id });
    const stored = (await db.select().from(schema.postings))[0]!;
    expect(stored.creditId).toBeGreaterThan(0);
    const dash2: any = await Actions.getDashboard.handler(ctx, {});
    const after = dash2.credits.find((c: any) => c.name === "ChatGPT Business Credit");
    expect(after.id).toBe(stored.creditId);
  });
});

describe("account nicknames — user-owned display prefixes", () => {
  test("a nickname survives re-import and renders in the dashboard + markdown", async () => {
    const db = createTestDb();
    const ctx = await importAccounts(db, [ALEX_ASPIRE]);
    const acct = (await db.select().from(schema.accounts))[0]!;
    await Actions.updateAccount.handler(ctx, { accountId: acct.id, nickname: "Asp" });

    // A Plaid re-import (which carries no nickname) must not clear it.
    await importAccounts(db, [{ ...ALEX_ASPIRE, balance: 999 }]);
    const after = (await db.select().from(schema.accounts))[0]!;
    expect(after.nickname).toBe("Asp");
    expect(after.balance).toBe(999); // balance still refreshes, of course

    const dash: any = await Actions.getDashboard.handler(ctx, {});
    const flight = dash.credits.find((c: any) => c.name === "Flight Credit");
    expect(flight.accountNickname).toBe("Asp");
    expect(dash.accounts[0].nickname).toBe("Asp");

    const md: string = ((await Actions.getAgentMarkdown.handler(ctx, {})) as any).markdown;
    expect(md).toContain("Login 1 1111 · Asp");
    expect(md).toContain('shown as "Asp"');
  });

  test("updateAccount corrects owner attribution (the user-side fix imports never apply)", async () => {
    const db = createTestDb();
    const ctx = await importAccounts(db, [{ ...ALEX_ASPIRE, owner: "A" }]);
    const acct = (await db.select().from(schema.accounts))[0]!;
    await Actions.updateAccount.handler(ctx, { accountId: acct.id, owner: "B" });
    expect((await db.select().from(schema.accounts))[0]!.owner).toBe("B");
    // And un-attributing is possible too.
    await Actions.updateAccount.handler(ctx, { accountId: acct.id, owner: null });
    expect((await db.select().from(schema.accounts))[0]!.owner).toBeNull();
  });
});

describe("listUnassignedCount — agrees with the dashboard", () => {
  test("excluded and compute-attributed postings are not counted", async () => {
    const db = createTestDb();
    const today = todayLA();
    const ctx = await importAccounts(db, [ALEX_BIZ_GOLD], [
      // Compute-time attributed to the synthesized ChatGPT credit once
      // the family is shown — the dashboard never lists it as unassigned.
      { txnId: "fake-lu-chat", accountPlaidId: ALEX_BIZ_GOLD.plaidAccountId, date: today, name: "AMEX ChatGPT Business Credit", amount: 25 },
      // Genuinely unmatched.
      { txnId: "fake-lu-mystery", accountPlaidId: ALEX_BIZ_GOLD.plaidAccountId, date: today, name: "Mystery Credit", amount: 5 },
    ]);
    await Actions.setExcludedCredits.handler(ctx, {
      excludedCredits: ["indeed", "adobe", "clear", "equinox", "entertainment", "walmart", "global entry", "farelock"],
    });
    const dash: any = await Actions.getDashboard.handler(ctx, {});
    const count: any = await Actions.listUnassignedCount.handler(ctx, {});
    expect(dash.unassigned.map((p: any) => p.name)).toEqual(["Mystery Credit"]);
    expect(count.count).toBe(dash.unassignedCount);
    expect(count.count).toBe(1);
  });
});

describe("timezone preference — period math follows the stored zone", () => {
  test("the dashboard reports the default zone, and setTimezone changes 'today'", async () => {
    const db = createTestDb();
    const ctx = await importAccounts(db, [ALEX_ASPIRE]);
    const prefs1: any = await Actions.getPreferences.handler(ctx, {});
    expect(prefs1.timezone).toBe("America/Los_Angeles");
    const dash1: any = await Actions.getDashboard.handler(ctx, {});
    expect(dash1.timezone).toBe("America/Los_Angeles");

    await Actions.setTimezone.handler(ctx, { timezone: "Pacific/Auckland" });
    const dash2: any = await Actions.getDashboard.handler(ctx, {});
    expect(dash2.timezone).toBe("Pacific/Auckland");
    // Auckland is ahead of Los Angeles: its calendar date is the LA
    // date or the day after — never behind.
    const laToday = todayLA();
    expect([laToday, addDays(laToday, 1)]).toContain(dash2.today);
  });

  test("an invalid timezone name is rejected", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    await expect(
      Actions.setTimezone.handler(ctx, { timezone: "Mars/Olympus" } as any),
    ).rejects.toThrow();
  });
});

describe("anchor pair validation (updateCredit / addCredit)", () => {
  test("a half-set anchor is rejected with a clear error", async () => {
    const db = createTestDb();
    const ctx = await importAccounts(db, [ALEX_ASPIRE]);
    const flight = (await db.select().from(schema.credits)).find(
      (r) => r.name === "Flight Credit",
    )!;
    await expect(
      Actions.updateCredit.handler(ctx, { id: flight.id, anchorMonth: 5 } as any),
    ).rejects.toThrow("must be set together");
    const acct = (await db.select().from(schema.accounts))[0]!;
    await expect(
      Actions.addCredit.handler(ctx, {
        accountId: acct.id,
        name: "Half Anchored",
        amount: 10,
        period: "annual",
        anchorDay: 15,
        note: "",
        matchPattern: "",
      } as any),
    ).rejects.toThrow("must be set together");
  });

  test("setting an anchor via updateCredit confirms it", async () => {
    const db = createTestDb();
    const ctx = await importAccounts(db, [ALEX_ASPIRE]);
    const flight = (await db.select().from(schema.credits)).find(
      (r) => r.name === "Flight Credit",
    )!;
    await Actions.updateCredit.handler(ctx, {
      id: flight.id,
      anchorMonth: 3,
      anchorDay: 15,
    });
    const after = (await db.select().from(schema.credits)).find(
      (r) => r.id === flight.id,
    )!;
    expect(after.anchorMonth).toBe(3);
    expect(after.anchorDay).toBe(15);
    expect(after.anchorConfirmed).toBe(1);
  });
});
