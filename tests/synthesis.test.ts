import { describe, expect, test } from "bun:test";
import { Actions, periodBounds } from "../server/src/actions";
import * as schema from "../server/src/schema";
import { createTestDb, fakeCtx, todayLA, type TestDb } from "./helpers";

/**
 * Compute-time catalog synthesis: computeDashboard materializes every
 * catalog credit for every stored account at read time and merges the
 * instances with stored credit rows (keyed by account + credit name;
 * stored rows win). These tests insert accounts DIRECTLY into the DB —
 * no importSnapshot, so no catalog rows are ever seeded — reproducing a
 * long-running deployment whose accounts predate the credit families.
 * All fixtures are fictional, like the rest of the suite.
 */

async function insertAccount(
  db: TestDb,
  acct: { plaidAccountId: string; name: string; mask: string; owner?: string },
) {
  const inserted = await db
    .insert(schema.accounts)
    .values({
      plaidAccountId: acct.plaidAccountId,
      name: acct.name,
      mask: acct.mask,
      balance: 0,
      creditLimit: null,
      issuer: "Amex",
      owner: acct.owner ?? "A",
      ignored: 0,
    })
    .returning();
  return inserted[0]!;
}

const BIZ_PLAT_NO_ROWS = {
  plaidAccountId: "fake-synth-bizplat-3333",
  name: "Business Platinum Card®",
  mask: "3333",
} as const;

describe("synthesis — hideable catalog credit with no stored row and no postings", () => {
  test("under the default preference it is named in hiddenCredits (with card + owner) and excluded from totals", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    await insertAccount(db, BIZ_PLAT_NO_ROWS);
    await Actions.setOwnerLabels.handler(ctx, { aLabel: "Alex" });

    const dash: any = await Actions.getDashboard.handler(ctx, {});
    // The three default-hidden Business Platinum families are named,
    // even though none of them has a stored row or a posting.
    expect(dash.hiddenCredits).toEqual([
      expect.objectContaining({
        name: "Adobe Credit",
        accountName: "Business Platinum Card®",
        mask: "3333",
        owner: "Alex",
      }),
      expect.objectContaining({
        name: "ChatGPT Business Credit",
        accountName: "Business Platinum Card®",
        mask: "3333",
        owner: "Alex",
      }),
      expect.objectContaining({
        name: "Indeed Credit",
        accountName: "Business Platinum Card®",
        mask: "3333",
        owner: "Alex",
      }),
    ]);
    const visibleNames = dash.credits.map((c: any) => c.name);
    expect(visibleNames).not.toContain("ChatGPT Business Credit");
    expect(visibleNames).not.toContain("Indeed Credit");
    expect(visibleNames).not.toContain("Adobe Credit");
    // Totals are exactly the visible catalog's $710 (300 hotel + 50
    // Hilton + 150 Dell + 200 airline + 10 wireless) — the hidden
    // families' $650 counts nowhere.
    expect(dash.totals.remainingNow).toBe(710);
    // Synthesis is compute-time only: the credits table is still empty.
    expect(await db.select().from(schema.credits)).toHaveLength(0);
  });

  test("removing its pattern from the preference surfaces it with the catalog amount and the correct current period", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    await insertAccount(db, BIZ_PLAT_NO_ROWS);

    const prefs: any = await Actions.getPreferences.handler(ctx, {});
    await Actions.setExcludedCredits.handler(ctx, {
      excludedCredits: prefs.excludedCredits.filter((p: string) => p !== "chatgpt"),
    });

    const dash: any = await Actions.getDashboard.handler(ctx, {});
    const chatgpt = dash.credits.find((c: any) => c.name === "ChatGPT Business Credit");
    expect(chatgpt).toBeDefined();
    expect(chatgpt.amount).toBe(300);
    expect(chatgpt.currentUsed).toBe(0);
    expect(chatgpt.currentRemaining).toBe(300);
    expect(chatgpt.currentPostings).toEqual([]);
    // Annual calendar cycle for the current year.
    const year = periodBounds("annual", todayLA());
    expect(chatgpt.period).toBe("annual");
    expect(chatgpt.periodStart).toBe(year.start);
    expect(chatgpt.periodEnd).toBe(year.end);
    // It left the hidden list; the still-excluded families remain there.
    expect(dash.hiddenCredits.map((h: any) => h.name)).toEqual([
      "Adobe Credit",
      "Indeed Credit",
    ]);
    // And it now counts toward the totals ($710 + $300), still with no
    // row ever written to the credits table.
    expect(dash.totals.remainingNow).toBe(1010);
    expect(await db.select().from(schema.credits)).toHaveLength(0);
  });

  test("the Agent Markdown names it under 'Hidden by preference', then renders it as a credit once un-hidden", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    await insertAccount(db, BIZ_PLAT_NO_ROWS);
    await Actions.setOwnerLabels.handler(ctx, { aLabel: "Alex" });

    let md: string = (await Actions.getAgentMarkdown.handler(ctx, {}) as any).markdown;
    expect(md).toContain("## Hidden by preference");
    expect(md).toContain(
      "- ChatGPT Business Credit — Alex · Business Platinum Card® ··3333",
    );
    expect(md).not.toContain("### ChatGPT Business Credit");

    const prefs: any = await Actions.getPreferences.handler(ctx, {});
    await Actions.setExcludedCredits.handler(ctx, {
      excludedCredits: prefs.excludedCredits.filter((p: string) => p !== "chatgpt"),
    });
    md = (await Actions.getAgentMarkdown.handler(ctx, {}) as any).markdown;
    expect(md).toContain("### ChatGPT Business Credit");
    expect(md).toContain("$300 credit · $0 used · $300 remaining · available");
    expect(md).not.toContain("- ChatGPT Business Credit — ");
    // The still-hidden families keep their section (and their names).
    expect(md).toContain("- Indeed Credit — Alex · Business Platinum Card® ··3333");
  });
});

describe("synthesis — visible catalog credit with no stored row", () => {
  test("appears as available with 0 used and the current catalog period", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    const acct = await insertAccount(db, {
      plaidAccountId: "fake-synth-aspire-1111",
      name: "Hilton Honors Aspire Card",
      mask: "1111",
    });

    const dash: any = await Actions.getDashboard.handler(ctx, {});
    const flight = dash.credits.find(
      (c: any) => c.accountId === acct.id && c.name === "Flight Credit",
    );
    expect(flight).toBeDefined();
    expect(flight.amount).toBe(50);
    expect(flight.currentUsed).toBe(0);
    expect(flight.currentRemaining).toBe(50);
    expect(flight.active).toBe(true);
    const quarter = periodBounds("quarterly", todayLA());
    expect(flight.periodStart).toBe(quarter.start);
    expect(flight.periodEnd).toBe(quarter.end);
    // The whole Aspire catalog is present and counted ($50 + $200).
    expect(
      dash.credits.find((c: any) => c.name === "Hilton Resort Credit")?.currentRemaining,
    ).toBe(200);
    expect(dash.totals.remainingNow).toBe(250);
    // The account reports a catalog even though it has no stored rows.
    expect(dash.accounts.find((a: any) => a.id === acct.id)?.hasCatalog).toBe(true);
    expect(await db.select().from(schema.credits)).toHaveLength(0);
  });

  test("a stored row for the same account + credit wins over the synthesized instance", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    const acct = await insertAccount(db, {
      plaidAccountId: "fake-synth-aspire-2222",
      name: "Hilton Honors Aspire Card",
      mask: "2222",
    });
    // A stored row the user edited (custom amount) — synthesis must not
    // shadow or duplicate it.
    const added: any = await Actions.addCredit.handler(ctx, {
      accountId: acct.id,
      name: "Flight Credit",
      amount: 75,
      period: "quarterly",
      note: "user-edited amount",
      matchPattern: "flight credit",
    });
    expect(added.id).toBeGreaterThan(0);

    const dash: any = await Actions.getDashboard.handler(ctx, {});
    const flights = dash.credits.filter((c: any) => c.name === "Flight Credit");
    expect(flights).toHaveLength(1);
    expect(flights[0].id).toBe(added.id);
    expect(flights[0].amount).toBe(75);
    expect(flights[0].note).toBe("user-edited amount");
  });
});
