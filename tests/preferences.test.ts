import { describe, expect, test } from "bun:test";
import { Actions, DEFAULT_EXCLUDED_PATTERNS } from "../server/src/actions";
import { createTestDb, fakeCtx, todayLA } from "./helpers";
import { ALEX_BIZ_PLAT } from "./fixtures/sample";

/**
 * Display-exclusion preference: which credits the dashboard hides. The
 * preference lives in the meta table (`excludedCredits`, a JSON list of
 * name patterns) and is changed ONLY through the getPreferences /
 * setExcludedCredits actions — both writers go through them: the
 * dashboard's Display settings section (one toggle per hideable family)
 * and the user's assistant from chat. getPreferences is the UI-facing
 * read: alongside the effective list it returns every hideable family
 * with its current hidden/shown state. Fixtures are fictional, like the
 * rest of the suite (Alex's Business Platinum plus an added "ChatGPT
 * Business Credit", a member of one of the default-hidden families).
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

  test("getPreferences lists every hideable family with its default hidden state", async () => {
    const db = createTestDb();
    const prefs: any = await Actions.getPreferences.handler(fakeCtx(db), {});
    // The Display settings toggles render from exactly this list: the
    // eight default-hidden families report hidden, the two opt-in
    // families (Global Entry, FareLock) report shown.
    expect(prefs.hideableFamilies).toEqual([
      { pattern: "chatgpt", label: "ChatGPT Business Credit", hidden: true },
      { pattern: "indeed", label: "Indeed Credit", hidden: true },
      { pattern: "adobe", label: "Adobe Credit", hidden: true },
      { pattern: "clear", label: "CLEAR+ Credit", hidden: true },
      { pattern: "equinox", label: "Equinox Credit", hidden: true },
      { pattern: "entertainment", label: "Digital Entertainment Credit", hidden: true },
      { pattern: "walmart", label: "Walmart+ Credit", hidden: true },
      { pattern: "instacart", label: "Instacart Credit", hidden: true },
      { pattern: "global entry", label: "Global Entry Credit", hidden: false },
      { pattern: "farelock", label: "FareLock Credit", hidden: false },
    ]);
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

  test("Instacart is hidden by default and can be un-hidden and re-hidden by name", async () => {
    const { ctx } = await seedBizPlatWithHiddenCredit();
    const dash0: any = await Actions.getDashboard.handler(ctx, {});
    await Actions.addCredit.handler(ctx, {
      accountId: dash0.accounts[0].id,
      name: "Instacart Credit",
      amount: 10,
      period: "monthly",
      note: "Instacart credit",
      matchPattern: "instacart",
    });

    // Default-hidden: named in Hidden by preference, counted nowhere.
    let dash: any = await Actions.getDashboard.handler(ctx, {});
    expect(dash.credits.map((c: any) => c.name)).not.toContain("Instacart Credit");
    expect(dash.hiddenCredits.map((h: any) => h.name)).toContain("Instacart Credit");
    expect(dash.totals.remainingNow).toBe(710);

    // Un-hide: drop just the "instacart" entry from the effective list.
    const prefs: any = await Actions.getPreferences.handler(ctx, {});
    await Actions.setExcludedCredits.handler(ctx, {
      excludedCredits: prefs.excludedCredits.filter((p: string) => p !== "instacart"),
    });
    dash = await Actions.getDashboard.handler(ctx, {});
    expect(dash.credits.map((c: any) => c.name)).toContain("Instacart Credit");
    expect(dash.totals.remainingNow).toBe(720);

    // Re-hide by passing the "instacart" pattern itself: validation
    // accepts it because Instacart is one of the hideable families.
    const prefs2: any = await Actions.getPreferences.handler(ctx, {});
    const res: any = await Actions.setExcludedCredits.handler(ctx, {
      excludedCredits: [...prefs2.excludedCredits, "instacart"],
    });
    expect(res.excludedCredits).toContain("instacart");
    dash = await Actions.getDashboard.handler(ctx, {});
    expect(dash.credits.map((c: any) => c.name)).not.toContain("Instacart Credit");
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
      "Exclusion entries in force: chatgpt, indeed, adobe, clear, equinox, entertainment, walmart, instacart",
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
    // A stored empty list is a real user selection, not "unset": the
    // UI-facing read reports every family shown (the defaults do NOT
    // come back).
    const prefs: any = await Actions.getPreferences.handler(ctx, {});
    expect(prefs.excludedCredits).toEqual([]);
    expect(prefs.hideableFamilies.every((f: any) => !f.hidden)).toBe(true);
  });

  test("Display-settings style toggles round-trip through getPreferences / setExcludedCredits", async () => {
    const { ctx } = await seedBizPlatWithHiddenCredit();
    const familyState = async (pattern: string) => {
      const prefs: any = await Actions.getPreferences.handler(ctx, {});
      return prefs.hideableFamilies.find((f: any) => f.pattern === pattern);
    };

    // Toggle ChatGPT OFF (show it): the settings UI removes every entry
    // that hides the family from the effective list and saves the
    // complete list back through setExcludedCredits.
    let prefs: any = await Actions.getPreferences.handler(ctx, {});
    const shown = prefs.excludedCredits.filter(
      (e: string) => !"chatgpt business credit".includes(e),
    );
    await Actions.setExcludedCredits.handler(ctx, { excludedCredits: shown });
    expect(await familyState("chatgpt")).toEqual({
      pattern: "chatgpt",
      label: "ChatGPT Business Credit",
      hidden: false,
    });
    let dash: any = await Actions.getDashboard.handler(ctx, {});
    expect(dash.credits.map((c: any) => c.name)).toContain("ChatGPT Business Credit");

    // Toggle FareLock ON (hide it): the UI appends the family's pattern.
    prefs = await Actions.getPreferences.handler(ctx, {});
    await Actions.setExcludedCredits.handler(ctx, {
      excludedCredits: [...prefs.excludedCredits, "farelock"],
    });
    expect(await familyState("farelock")).toEqual({
      pattern: "farelock",
      label: "FareLock Credit",
      hidden: true,
    });
    // The other toggles are untouched by either save.
    expect((await familyState("indeed")).hidden).toBe(true);
    expect((await familyState("global entry")).hidden).toBe(false);
    expect((await familyState("chatgpt")).hidden).toBe(false);
    dash = await Actions.getDashboard.handler(ctx, {});
    expect(dash.excludedPatterns).toContain("farelock");
  });

  test("a family stored under its full credit name still reports hidden", async () => {
    const { ctx } = await seedBizPlatWithHiddenCredit();
    // Chat can store the full name instead of the short pattern; the
    // toggle state must reflect the same substring matching the
    // dashboard filter uses, or the UI would show it as "shown" while
    // the dashboard hides it.
    await Actions.setExcludedCredits.handler(ctx, {
      excludedCredits: ["Global Entry Credit"],
    });
    const prefs: any = await Actions.getPreferences.handler(ctx, {});
    expect(
      prefs.hideableFamilies.find((f: any) => f.pattern === "global entry").hidden,
    ).toBe(true);
    expect(
      prefs.hideableFamilies.find((f: any) => f.pattern === "chatgpt").hidden,
    ).toBe(false);
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

describe("setExcludedCredits — canonical entries only", () => {
  test("fragments that would hide nearly everything are rejected", async () => {
    const { ctx } = await seedBizPlatWithHiddenCredit();
    // "credit" is a substring of almost every credit name; "air" hits
    // Airline Fee Credit and more. Neither is a canonical entry.
    await expect(
      Actions.setExcludedCredits.handler(ctx, { excludedCredits: ["credit"] }),
    ).rejects.toThrow("unknown credit name");
    await expect(
      Actions.setExcludedCredits.handler(ctx, { excludedCredits: ["air"] }),
    ).rejects.toThrow("unknown credit name");
    // Canonical entries — a family pattern, a family label, and a full
    // credit name — are all accepted.
    const res: any = await Actions.setExcludedCredits.handler(ctx, {
      excludedCredits: ["chatgpt", "Global Entry Credit", "ChatGPT Business Credit"],
    });
    expect(res.excludedCredits).toEqual([
      "chatgpt",
      "global entry credit",
      "chatgpt business credit",
    ]);
  });
});
