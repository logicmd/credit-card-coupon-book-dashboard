import { describe, expect, test } from "bun:test";
import { Actions, DEFAULT_EXCLUDED_PATTERNS } from "../server/src/actions";
import { createTestDb, fakeCtx, todayLA } from "./helpers";
import { ALEX_BIZ_PLAT } from "./fixtures/sample";

/**
 * Display-exclusion preference: which credits the dashboard hides. The
 * preference lives in the meta table (`excludedCredits`, a JSON list of
 * name patterns) and is changed ONLY through the getPreferences /
 * setExcludedCredits actions — there is no settings UI; the user's
 * assistant flips it from chat. Fixtures are fictional, like the rest of
 * the suite (Alex's Business Platinum plus an added "ChatGPT Business
 * Credit", a member of one of the default-hidden families).
 */

async function seedBizPlatWithHiddenCredit() {
  const db = createTestDb();
  const ctx = fakeCtx(db);
  await Actions.importSnapshot.handler(ctx, {
    complete: true,
    windowStart: "2026-01-01",
    windowEnd: todayLA(),
    accounts: [ALEX_BIZ_PLAT],
    postings: [],
  } as any);
  const dash0: any = await Actions.getDashboard.handler(ctx, {});
  const added: any = await Actions.addCredit.handler(ctx, {
    accountId: dash0.accounts[0].id,
    name: "ChatGPT Business Credit",
    amount: 300,
    period: "annual",
    note: "ChatGPT Business subscription credit",
    matchPattern: "chatgpt",
  });
  return { db, ctx, creditId: added.id as number };
}

describe("exclusion preference — defaults", () => {
  test("getPreferences returns the built-in defaults when nothing was ever stored", async () => {
    const db = createTestDb();
    const prefs: any = await Actions.getPreferences.handler(fakeCtx(db), {});
    expect(prefs.excludedCredits).toEqual([...DEFAULT_EXCLUDED_PATTERNS]);
  });

  test("default exclusions apply when the preference was never set", async () => {
    const { ctx } = await seedBizPlatWithHiddenCredit();
    const dash: any = await Actions.getDashboard.handler(ctx, {});
    expect(dash.excludedPatterns).toEqual([...DEFAULT_EXCLUDED_PATTERNS]);
    expect(dash.credits.map((c: any) => c.name)).not.toContain("ChatGPT Business Credit");
    // Hidden by name: the stored ChatGPT row PLUS the card's other two
    // default-hidden families (Adobe, Indeed), which have no stored rows
    // at all — compute-time synthesis is what lets the preference name
    // them here (previously only stored rows could be listed).
    expect(dash.hiddenCredits).toEqual([
      expect.objectContaining({
        name: "Adobe Credit",
        accountName: "Business Platinum Card®",
        mask: "3333",
      }),
      expect.objectContaining({
        name: "ChatGPT Business Credit",
        accountName: "Business Platinum Card®",
        mask: "3333",
      }),
      expect.objectContaining({
        name: "Indeed Credit",
        accountName: "Business Platinum Card®",
        mask: "3333",
      }),
    ]);
    // The Business Platinum catalog alone totals $710 of current-period
    // remaining (300 hotel + 50 Hilton + 150 Dell + 200 airline + 10
    // wireless); the hidden $300 ChatGPT credit counts nowhere.
    expect(dash.totals.remainingNow).toBe(710);
  });

  test("the Agent Markdown names the hidden credits under 'Hidden by preference'", async () => {
    const { ctx } = await seedBizPlatWithHiddenCredit();
    await Actions.setOwnerLabels.handler(ctx, { aLabel: "Alex" });
    const res: any = await Actions.getAgentMarkdown.handler(ctx, {});
    const md: string = res.markdown;
    expect(md).toContain("## Hidden by preference");
    expect(md).toContain("not counted in any total above");
    expect(md).toContain(
      "- ChatGPT Business Credit — Alex · Business Platinum Card® ··3333",
    );
    expect(md).toContain(
      "Exclusion entries in force: chatgpt, indeed, adobe, clear, equinox, entertainment, walmart",
    );
    // Named as hidden only — never rendered as a tracked credit block.
    expect(md).not.toContain("### ChatGPT Business Credit");
  });
});

describe("exclusion preference — changes via the actions", () => {
  test("removing an entry makes the credit appear in the dashboard and the markdown", async () => {
    const { ctx } = await seedBizPlatWithHiddenCredit();
    const prefs: any = await Actions.getPreferences.handler(ctx, {});
    const next = prefs.excludedCredits.filter((p: string) => p !== "chatgpt");
    const res: any = await Actions.setExcludedCredits.handler(ctx, {
      excludedCredits: next,
    });
    expect(res.excludedCredits).not.toContain("chatgpt");

    const dash: any = await Actions.getDashboard.handler(ctx, {});
    expect(dash.credits.map((c: any) => c.name)).toContain("ChatGPT Business Credit");
    // Only "chatgpt" was removed: the card's other default-hidden
    // families (Adobe, Indeed) stay hidden — they are synthesized
    // instances, so they are named here despite having no stored rows.
    expect(dash.hiddenCredits.map((h: any) => h.name)).toEqual([
      "Adobe Credit",
      "Indeed Credit",
    ]);
    // Now it counts: $710 of catalog credits + the $300 ChatGPT credit.
    expect(dash.totals.remainingNow).toBe(1010);

    const md: string = (await Actions.getAgentMarkdown.handler(ctx, {}) as any).markdown;
    expect(md).toContain("### ChatGPT Business Credit");
    expect(md).not.toContain("- ChatGPT Business Credit — ");
  });

  test("full credit names are accepted, and an empty list un-hides everything", async () => {
    const { ctx } = await seedBizPlatWithHiddenCredit();
    const byName: any = await Actions.setExcludedCredits.handler(ctx, {
      excludedCredits: ["ChatGPT Business Credit", "Uber One Credit"],
    });
    // Entries are stored normalized (trimmed, lowercased).
    expect(byName.excludedCredits).toEqual([
      "chatgpt business credit",
      "uber one credit",
    ]);
    let dash: any = await Actions.getDashboard.handler(ctx, {});
    expect(dash.credits.map((c: any) => c.name)).not.toContain("ChatGPT Business Credit");

    await Actions.setExcludedCredits.handler(ctx, { excludedCredits: [] });
    dash = await Actions.getDashboard.handler(ctx, {});
    expect(dash.excludedPatterns).toEqual([]);
    expect(dash.credits.map((c: any) => c.name)).toContain("ChatGPT Business Credit");
    expect(dash.hiddenCredits).toEqual([]);
  });

  test("unknown credit names are rejected and the stored preference is unchanged", async () => {
    const { ctx } = await seedBizPlatWithHiddenCredit();
    await expect(
      Actions.setExcludedCredits.handler(ctx, {
        excludedCredits: ["chatgpt", "Nonexistent Credit"],
      }),
    ).rejects.toThrow(/unknown credit name/);
    // Too-short entries match almost everything and are rejected as well.
    await expect(
      Actions.setExcludedCredits.handler(ctx, { excludedCredits: ["ai"] }),
    ).rejects.toThrow(/unknown credit name/);
    const prefs: any = await Actions.getPreferences.handler(ctx, {});
    expect(prefs.excludedCredits).toEqual([...DEFAULT_EXCLUDED_PATTERNS]);
  });
});
