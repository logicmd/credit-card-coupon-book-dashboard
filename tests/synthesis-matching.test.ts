import { describe, expect, test } from "bun:test";
import { asc } from "drizzle-orm";
import { Actions } from "../server/src/actions";
import * as schema from "../server/src/schema";
import { createTestDb, fakeCtx, todayLA, type TestDb } from "./helpers";
import {
  ALEX_ASPIRE,
  ALEX_BIZ_GOLD,
  ALEX_BIZ_PLAT,
  SAM_BIZ_GOLD,
} from "./fixtures/sample";

/**
 * Compute-time attribution: the non-seeded catalog families (ChatGPT
 * Business, Indeed, Adobe, …) never get stored credit rows, so import
 * can never assign a posting to them — a ChatGPT reimbursement posting
 * lands in the DB with creditId null even though its name matches the
 * family's catalog pattern. computeDashboard therefore attributes
 * unassigned postings to the account's SYNTHESIZED instances at read
 * time (same match rule as import), so the reimbursement counts as
 * that credit's usage with no manual assignment and nothing persisted.
 * All fixtures are fictional, like the rest of the suite.
 */

const YEAR = Number(todayLA().slice(0, 4));
const inYear = (mmdd: string) => `${YEAR}-${mmdd}`;

async function unhideChatgpt(db: TestDb) {
  const ctx = fakeCtx(db);
  const prefs: any = await Actions.getPreferences.handler(ctx, {});
  await Actions.setExcludedCredits.handler(ctx, {
    excludedCredits: prefs.excludedCredits.filter((p: string) => p !== "chatgpt"),
  });
}

async function importPostings(
  db: TestDb,
  accounts: unknown[],
  postings: unknown[],
) {
  return Actions.importSnapshot.handler(fakeCtx(db), {
    windowStart: inYear("01-01"),
    windowEnd: inYear("12-31"),
    complete: true,
    accounts,
    postings,
  } as any);
}

function creditOn(dash: any, accountId: number, name: string) {
  return dash.credits.find((c: any) => c.accountId === accountId && c.name === name);
}

describe("compute-time attribution — ChatGPT postings on a Business Gold account", () => {
  test("reimbursements stored unassigned count as the synthesized ChatGPT credit's usage", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);

    // The account plus a Flexible posting in the current month (the one
    // seeded Business Gold credit — import-matched persistently).
    await importPostings(db, [SAM_BIZ_GOLD], [
      {
        txnId: "fake-txn-flex-1",
        accountPlaidId: SAM_BIZ_GOLD.plaidAccountId,
        date: todayLA(),
        name: "FLEXIBLE BUSINESS CREDIT",
        amount: 20,
      },
    ]);
    const acct = (await db.select().from(schema.accounts))[0]!;

    await unhideChatgpt(db);
    const before: any = await Actions.getDashboard.handler(ctx, {});
    const chatBefore = creditOn(before, acct.id, "ChatGPT Business Credit");
    expect(chatBefore).toBeDefined();
    expect(chatBefore.currentUsed).toBe(0);
    expect(chatBefore.currentRemaining).toBe(300);
    // Flexible is used up by its posting; the whole visible total is the
    // untouched $300 ChatGPT credit.
    expect(before.totals.remainingNow).toBe(300);

    // Six ChatGPT reimbursements across the current year (total
    // $191.78), plus one from last year.
    const amounts = [32, 32, 32, 32, 32, 31.78];
    const months = ["02-10", "03-10", "05-10", "06-10", "08-10", "09-10"];
    await importPostings(
      db,
      [],
      [
        ...amounts.map((amount, i) => ({
          txnId: `fake-txn-chatgpt-${i + 1}`,
          accountPlaidId: SAM_BIZ_GOLD.plaidAccountId,
          date: inYear(months[i]!),
          name: "AMEX ChatGPT Credit",
          amount,
        })),
        {
          txnId: "fake-txn-chatgpt-prior-year",
          accountPlaidId: SAM_BIZ_GOLD.plaidAccountId,
          date: `${YEAR - 1}-06-15`,
          name: "AMEX ChatGPT Credit",
          amount: 50,
        },
      ],
    );

    // Import could not assign them (no stored ChatGPT row exists), and
    // attribution persists nothing either — every ChatGPT posting is
    // still creditId null in the DB.
    const stored = await db
      .select()
      .from(schema.postings)
      .orderBy(asc(schema.postings.id));
    const chatStored = stored.filter((p) => p.name === "AMEX ChatGPT Credit");
    expect(chatStored).toHaveLength(7);
    expect(chatStored.every((p) => p.creditId == null)).toBe(true);
    expect(stored.find((p) => p.name === "FLEXIBLE BUSINESS CREDIT")?.creditId).not.toBeNull();
    expect(await db.select().from(schema.credits)).toHaveLength(1); // Flexible only

    const after: any = await Actions.getDashboard.handler(ctx, {});
    const chat = creditOn(after, acct.id, "ChatGPT Business Credit");
    // The six current-year postings count; last year's is bucketed out
    // of the current annual period like any assigned posting.
    expect(chat.currentUsed).toBe(191.78);
    expect(chat.currentRemaining).toBe(108.22);
    expect(chat.currentPostings).toHaveLength(6);
    expect(
      Math.round(chat.currentPostings.reduce((s: number, p: any) => s + p.amount, 0) * 100) / 100,
    ).toBe(191.78);
    // The dashboard total dropped by exactly the reimbursed amount.
    expect(after.totals.remainingNow).toBe(108.22);
    expect(before.totals.remainingNow - after.totals.remainingNow).toBe(191.78);
    // None of the ChatGPT postings is left in Unassigned.
    expect(after.unassigned.filter((p: any) => p.name === "AMEX ChatGPT Credit")).toHaveLength(0);
    // And nothing leaked into the account's other credit.
    const flex = creditOn(after, acct.id, "Flexible Business Credit");
    expect(flex.currentUsed).toBe(20);
    expect(flex.currentRemaining).toBe(0);
    expect(flex.currentPostings).toHaveLength(1);

    // The Agent Markdown tells the same story.
    const md: string = ((await Actions.getAgentMarkdown.handler(ctx, {})) as any).markdown;
    expect(md).toContain("$300 credit · $191.78 used · $108.22 remaining · partially used");
  });

  test("while the family is hidden, its postings surface nowhere and count nowhere", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    await importPostings(db, [SAM_BIZ_GOLD], [
      {
        txnId: "fake-txn-chatgpt-hidden",
        accountPlaidId: SAM_BIZ_GOLD.plaidAccountId,
        date: inYear("04-10"),
        name: "AMEX ChatGPT Credit",
        amount: 45,
      },
    ]);
    const acct = (await db.select().from(schema.accounts))[0]!;

    // Default preference: chatgpt stays hidden.
    const dash: any = await Actions.getDashboard.handler(ctx, {});
    expect(creditOn(dash, acct.id, "ChatGPT Business Credit")).toBeUndefined();
    expect(dash.hiddenCredits).toContainEqual(
      expect.objectContaining({
        name: "ChatGPT Business Credit",
        accountName: SAM_BIZ_GOLD.name,
      }),
    );
    expect(dash.unassigned).toHaveLength(0);
    // Only the untouched $20 Flexible credit is visible and counted.
    expect(dash.totals.remainingNow).toBe(20);
  });
});

describe("compute-time attribution — no leaks", () => {
  test("a ChatGPT posting counts only toward its own account's ChatGPT credit", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    await importPostings(
      db,
      [ALEX_ASPIRE, ALEX_BIZ_PLAT, ALEX_BIZ_GOLD],
      [
        {
          // A ChatGPT-named posting on a NON-business card: no catalog
          // for the Aspire carries a ChatGPT credit, so nothing may
          // claim it — it stays unassigned for manual review.
          txnId: "fake-txn-chatgpt-on-aspire",
          accountPlaidId: ALEX_ASPIRE.plaidAccountId,
          date: inYear("03-10"),
          name: "AMEX ChatGPT Credit",
          amount: 60,
        },
        {
          txnId: "fake-txn-chatgpt-on-bizplat",
          accountPlaidId: ALEX_BIZ_PLAT.plaidAccountId,
          date: inYear("04-10"),
          name: "AMEX ChatGPT Credit",
          amount: 75,
        },
      ],
    );
    const accounts = await db.select().from(schema.accounts);
    const byPlaid = new Map(accounts.map((a) => [a.plaidAccountId, a]));
    await unhideChatgpt(db);

    const dash: any = await Actions.getDashboard.handler(ctx, {});
    // Business Platinum's own ChatGPT credit absorbed its posting —
    // attribution works for every business account, not just one.
    const platChat = creditOn(
      dash,
      byPlaid.get(ALEX_BIZ_PLAT.plaidAccountId)!.id,
      "ChatGPT Business Credit",
    );
    expect(platChat.currentUsed).toBe(75);
    expect(platChat.currentRemaining).toBe(225);
    // The other Business Gold (no ChatGPT postings) is untouched.
    const goldChat = creditOn(
      dash,
      byPlaid.get(ALEX_BIZ_GOLD.plaidAccountId)!.id,
      "ChatGPT Business Credit",
    );
    expect(goldChat.currentUsed).toBe(0);
    expect(goldChat.currentRemaining).toBe(300);
    // The Aspire has no ChatGPT credit at all, and its posting is the
    // only one left unassigned.
    expect(
      dash.credits.some(
        (c: any) =>
          c.accountId === byPlaid.get(ALEX_ASPIRE.plaidAccountId)!.id &&
          c.name === "ChatGPT Business Credit",
      ),
    ).toBe(false);
    expect(dash.unassigned).toHaveLength(1);
    expect(dash.unassigned[0].name).toBe("AMEX ChatGPT Credit");
    expect(dash.unassigned[0].accountName).toBe(ALEX_ASPIRE.name);
  });

  test("a posting deliberately unassigned from a stored credit is not re-matched at compute time", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    await importPostings(db, [SAM_BIZ_GOLD], [
      {
        txnId: "fake-txn-flex-unassigned",
        accountPlaidId: SAM_BIZ_GOLD.plaidAccountId,
        date: todayLA(),
        name: "FLEXIBLE BUSINESS CREDIT",
        amount: 20,
      },
    ]);
    const posting = (await db.select().from(schema.postings))[0]!;
    expect(posting.creditId).not.toBeNull(); // import auto-matched it
    // The user deliberately unassigns it. Flexible Business Credit is a
    // STORED credit: its assignment is persisted state, and compute-time
    // attribution (which serves only synthesized instances) must not
    // override the user's action.
    await Actions.assignPosting.handler(ctx, { postingId: posting.id, creditId: null });
    await unhideChatgpt(db);

    const dash: any = await Actions.getDashboard.handler(ctx, {});
    const acct = (await db.select().from(schema.accounts))[0]!;
    const flex = creditOn(dash, acct.id, "Flexible Business Credit");
    expect(flex.currentUsed).toBe(0);
    expect(flex.currentRemaining).toBe(20);
    expect(dash.unassigned).toHaveLength(1);
    expect(dash.unassigned[0].name).toBe("FLEXIBLE BUSINESS CREDIT");
  });
});
