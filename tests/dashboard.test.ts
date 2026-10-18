import { describe, expect, test } from "bun:test";
import { addDays, Actions, periodBounds } from "../server/src/actions";
import * as schema from "../server/src/schema";
import { createTestDb, fakeCtx, todayLA } from "./helpers";
import { ALEX_ASPIRE, SAM_ASPIRE, SAM_STORE_CARD } from "./fixtures/sample";

/**
 * Two Aspire cards (Alex's and Sam's) with postings anchored to the CURRENT
 * period windows, so the dashboard's current-period math is exercised
 * deterministically no matter when the suite runs:
 *  - Alex: flight credit fully used this quarter (+ a posting LAST quarter
 *    that must not count), resort credit untouched.
 *  - Sam: flight credit partly used this quarter, resort credit fully used.
 */
async function seedTwoAspires(db: ReturnType<typeof createTestDb>) {
  const today = todayLA();
  const quarterStart = periodBounds("quarterly", today).start;
  const halfStart = periodBounds("semiannual", today).start;
  await Actions.importSnapshot.handler(fakeCtx(db), {
    complete: true,
    windowStart: halfStart,
    windowEnd: today,
    accounts: [ALEX_ASPIRE, SAM_ASPIRE],
    postings: [
      { txnId: "fake-d-alex-flight", accountPlaidId: ALEX_ASPIRE.plaidAccountId, date: quarterStart, name: "Hilton", amount: 50 },
      { txnId: "fake-d-alex-flight-old", accountPlaidId: ALEX_ASPIRE.plaidAccountId, date: addDays(quarterStart, -10), name: "Hilton", amount: 50 },
      { txnId: "fake-d-sam-flight", accountPlaidId: SAM_ASPIRE.plaidAccountId, date: quarterStart, name: "Hilton", amount: 20 },
      { txnId: "fake-d-sam-resort", accountPlaidId: SAM_ASPIRE.plaidAccountId, date: halfStart, name: "Hilton", amount: 200 },
    ],
  } as any);
  const accounts = await db.select().from(schema.accounts);
  return {
    alexId: accounts.find((a) => a.plaidAccountId === ALEX_ASPIRE.plaidAccountId)!.id,
    samId: accounts.find((a) => a.plaidAccountId === SAM_ASPIRE.plaidAccountId)!.id,
  };
}

describe("getDashboard — current-period usage across cards", () => {
  test("usage counts only postings inside the current period window", async () => {
    const db = createTestDb();
    const { alexId, samId } = await seedTwoAspires(db);
    const dash: any = await Actions.getDashboard.handler(fakeCtx(db), {});

    const flightOf = (accountId: number) =>
      dash.credits.find((c: any) => c.accountId === accountId && c.name === "Flight Credit");
    // Alex used $50 this quarter; last quarter's $50 posting does not leak in.
    expect(flightOf(alexId).currentUsed).toBe(50);
    expect(flightOf(alexId).currentPostings).toHaveLength(1);
    expect(flightOf(alexId).currentRemaining).toBe(0);
    expect(flightOf(samId).currentUsed).toBe(20);
    expect(flightOf(samId).currentRemaining).toBe(30);
  });

  test("totals aggregate remaining credit across all cards and logins", async () => {
    const db = createTestDb();
    await seedTwoAspires(db);
    const dash: any = await Actions.getDashboard.handler(fakeCtx(db), {});
    // Alex resort $200 left + Sam flight $30 left; everything else used up.
    expect(dash.totals.remainingNow).toBe(230);
    expect(dash.totals.openCredits).toBe(2);
  });

  test("owner labels resolve from meta settings, defaulting to neutral names", async () => {
    const db = createTestDb();
    const { alexId, samId } = await seedTwoAspires(db);
    let dash: any = await Actions.getDashboard.handler(fakeCtx(db), {});
    expect(dash.ownerLabels).toEqual(["Login 1", "Login 2"]);
    expect(dash.accounts.find((a: any) => a.id === alexId).owner).toBe("Login 1");
    expect(dash.accounts.find((a: any) => a.id === samId).owner).toBe("Login 2");

    await Actions.setOwnerLabels.handler(fakeCtx(db), { aLabel: "Alex", bLabel: "Sam" });
    dash = await Actions.getDashboard.handler(fakeCtx(db), {});
    expect(dash.ownerLabels).toEqual(["Alex", "Sam"]);
    expect(dash.accounts.find((a: any) => a.id === alexId).owner).toBe("Alex");
    expect(dash.credits.find((c: any) => c.accountId === samId).owner).toBe("Sam");
  });

  test("ignoring an account removes its credits from the dashboard and totals", async () => {
    const db = createTestDb();
    const { samId } = await seedTwoAspires(db);
    await Actions.setAccountIgnored.handler(fakeCtx(db), { accountId: samId, ignored: true });
    const dash: any = await Actions.getDashboard.handler(fakeCtx(db), {});
    expect(dash.credits.every((c: any) => c.accountId !== samId)).toBe(true);
    // Only Alex's untouched $200 resort credit remains.
    expect(dash.totals.remainingNow).toBe(200);
  });
});

describe("getDashboard — exclusion list and unassigned postings", () => {
  test("an excluded benefit never appears in credits, totals, or unassigned", async () => {
    const db = createTestDb();
    const { alexId } = await seedTwoAspires(db);
    const ctx = fakeCtx(db);

    // A real (but excluded) credit on Alex's card, partly used via manual entry.
    const added: any = await Actions.addCredit.handler(ctx, {
      accountId: alexId,
      name: "ChatGPT Business Credit",
      amount: 300,
      period: "annual",
      note: "",
      matchPattern: "chatgpt",
    });
    await Actions.addManualPosting.handler(ctx, {
      creditId: added.id,
      date: todayLA(),
      amount: 100,
      note: "",
    });

    // An excluded-name posting on a catalog-less card stays out of Unassigned,
    // while an ordinary unrecognized posting shows up there for review.
    await Actions.importSnapshot.handler(ctx, {
      complete: true,
      windowStart: periodBounds("annual", todayLA()).start,
      windowEnd: todayLA(),
      accounts: [SAM_STORE_CARD],
      postings: [
        { txnId: "fake-d-excluded-posting", accountPlaidId: SAM_STORE_CARD.plaidAccountId, date: todayLA(), name: "AMEX ChatGPT Business Credit", amount: 66 },
        { txnId: "fake-d-mystery-posting", accountPlaidId: SAM_STORE_CARD.plaidAccountId, date: todayLA(), name: "Mystery Statement Credit", amount: 5 },
      ],
    } as any);

    const dash: any = await Actions.getDashboard.handler(ctx, {});
    expect(dash.credits.some((c: any) => c.name.toLowerCase().includes("chatgpt"))).toBe(false);
    // The excluded credit's $200 of remaining balance must not inflate totals.
    expect(dash.totals.remainingNow).toBe(230);
    expect(dash.unassigned.map((u: any) => u.name)).toEqual(["Mystery Statement Credit"]);
  });

  test("pinned credits stay visible even after being toggled inactive", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    await Actions.importSnapshot.handler(ctx, {
      complete: true,
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
      accounts: [
        {
          plaidAccountId: "fake-alex-bizgold-5555",
          name: "Business Gold Card",
          mask: "5555",
          balance: 10,
          creditLimit: null,
          owner: "A",
        },
      ],
      postings: [],
    } as any);
    const credits = await db.select().from(schema.credits);
    const flexible = credits.find((c) => c.name === "Flexible Business Credit")!;
    await Actions.updateCredit.handler(ctx, { id: flexible.id, active: false });

    const dash: any = await Actions.getDashboard.handler(ctx, {});
    const shown = dash.credits.find((c: any) => c.id === flexible.id);
    expect(shown).toBeDefined();
    expect(shown.active).toBe(true); // pinned: displayed active regardless of the stored toggle
  });
});
