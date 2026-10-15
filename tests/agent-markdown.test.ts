import { describe, expect, test } from "bun:test";
import { addDays, Actions, periodBounds, type DashboardData } from "../server/src/actions";
import { renderAgentMarkdown } from "../server/src/agentMarkdown";
import { createTestDb, fakeCtx, todayLA } from "./helpers";
import { ALEX_ASPIRE, SAM_ASPIRE } from "./fixtures/sample";

/**
 * Agent Markdown export: a one-file snapshot of the dashboard state that a
 * user pastes to an AI assistant. All data here is fictional (Alex / Sam,
 * fake masks), like the rest of the suite. The renderer tests use a fixed
 * "today" (2026-10-15) so ordering and totals are deterministic; the action
 * test anchors to the real current periods like dashboard.test.ts does.
 */

type Credit = DashboardData["credits"][number];

function credit(overrides: Partial<Credit>): Credit {
  return {
    id: 1,
    accountId: 1,
    accountName: "Business Platinum Card®",
    mask: "3333",
    owner: "Alex",
    name: "Wireless Credit",
    amount: 10,
    period: "monthly",
    anchorMonth: null,
    anchorDay: null,
    enrolled: true,
    active: true,
    note: "",
    matchPattern: "",
    currentUsed: 0,
    currentRemaining: 10,
    periodLabel: "October 2026",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    nextPeriodStart: "2026-11-01",
    daysLeft: 16,
    currentPostings: [],
    ...overrides,
  };
}

const GENERATED_AT = new Date("2026-10-15T12:00:00.000Z");

/** A full fictional dashboard: five open credits + one used up + one stopped. */
function sampleDashboard(): DashboardData {
  const credits: Credit[] = [
    credit({ id: 1 }), // Wireless, $10 open, ends 2026-10-31
    credit({
      id: 2,
      accountName: "The Ritz-Carlton® Credit Card",
      mask: "9999",
      name: "Travel Credit",
      amount: 300,
      period: "annual",
      currentUsed: 100,
      currentRemaining: 200,
      periodLabel: "2026",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      nextPeriodStart: "2027-01-01",
      daysLeft: 77,
      note: "Airline incidentals only; NOT automatic — request it via J.P. Morgan Priority Services within 4 billing cycles of the purchase",
      currentPostings: [
        { id: 21, date: "2026-03-05", postedDate: "2026-03-05", name: "Manual entry", amount: 100, source: "manual" },
      ],
    }),
    credit({
      id: 3,
      name: "Hilton Credit",
      amount: 50,
      period: "quarterly",
      currentRemaining: 50,
      periodLabel: "Q4 2026",
      periodStart: "2026-10-01",
      periodEnd: "2026-12-31",
      nextPeriodStart: "2027-01-01",
      daysLeft: 77,
      enrolled: false,
      note: "Direct Hilton purchases; needs Hilton for Business enrollment",
    }),
    credit({
      id: 4,
      accountId: 2,
      accountName: "Hilton Honors Aspire Card",
      mask: "2222",
      owner: "Sam",
      name: "Flight Credit",
      amount: 50,
      period: "quarterly",
      currentUsed: 20,
      currentRemaining: 30,
      periodLabel: "Q4 2026",
      periodStart: "2026-10-01",
      periodEnd: "2026-12-31",
      nextPeriodStart: "2027-01-01",
      daysLeft: 77,
      note: "Flights booked directly with airlines or Amex Travel",
      currentPostings: [
        { id: 22, date: "2026-10-03", postedDate: "2026-10-03", name: "AMEX Flight Credit", amount: 20, source: "plaid" },
      ],
    }),
    credit({
      id: 5,
      accountId: 3,
      accountName: "Chase Sapphire Preferred®",
      mask: "6666",
      name: "Annual Hotel Credit",
      amount: 50,
      period: "annual",
      anchorMonth: 5,
      anchorDay: 1,
      currentRemaining: 50,
      periodLabel: "May 2026 – April 2027",
      periodStart: "2026-05-01",
      periodEnd: "2027-04-30",
      nextPeriodStart: "2027-05-01",
      daysLeft: 197,
      note: "Hotel bookings through Chase Travel only; runs on the cardmember anniversary year",
    }),
    credit({
      id: 6,
      name: "Hotel Credit (FHR / Hotel Collection)",
      amount: 300,
      period: "semiannual",
      currentUsed: 300,
      currentRemaining: 0,
      periodLabel: "Jul–Dec 2026",
      periodStart: "2026-07-01",
      periodEnd: "2026-12-31",
      nextPeriodStart: "2027-01-01",
      daysLeft: 77,
      note: "Prepaid FHR or The Hotel Collection via Amex Travel; Hotel Collection needs 2+ nights",
      currentPostings: [
        { id: 23, date: "2026-09-30", postedDate: "2026-10-02", name: "Platinum Hotel Credit", amount: 300, source: "plaid" },
      ],
    }),
    credit({
      id: 7,
      name: "Saks Credit",
      amount: 50,
      period: "semiannual",
      currentRemaining: 50,
      active: false,
      periodLabel: "Jul–Dec 2026",
      periodStart: "2026-07-01",
      periodEnd: "2026-12-31",
      nextPeriodStart: "2027-01-01",
      daysLeft: 77,
    }),
  ];
  return {
    lastImportAt: "2026-10-15T08:00:00.000Z",
    ownerLabels: ["Alex", "Sam"],
    dataCoverageStart: "2026-01-01",
    lastRefreshWindowStart: "2026-09-16",
    today: "2026-10-15",
    accounts: [],
    credits,
    unassigned: [],
    totals: { remainingNow: 340, expiring14: 0, expiring31: 10, openCredits: 5 },
  };
}

describe("renderAgentMarkdown", () => {
  test("title, generated-at timestamp, and headline totals", () => {
    const md = renderAgentMarkdown(sampleDashboard(), GENERATED_AT);
    expect(md.startsWith("# Credit Card Coupon Book")).toBe(true);
    expect(md).toContain("Generated: 2026-10-15T12:00:00.000Z");
    expect(md).toContain("Current periods as of 2026-10-15");
    expect(md).toContain("Total unused in current periods: $340 across 5 open credits");
    // Only the Wireless credit ends at the nearest boundary (2026-10-31).
    expect(md).toContain("Expiring soonest: $10 on 2026-10-31 (1 credit)");
  });

  test("credits are ordered urgency-first: nearest period end, largest remaining on ties", () => {
    const md = renderAgentMarkdown(sampleDashboard(), GENERATED_AT);
    const at = (s: string) => md.indexOf(s);
    expect(at("### Wireless Credit")).toBeGreaterThan(-1);
    // 2026-10-31 first; within 2026-12-31, $200 (Travel) > $50 (Hilton) > $30 (Flight);
    // the anniversary-year hotel credit (ends 2027-04-30) is last among open credits.
    expect(at("### Wireless Credit")).toBeLessThan(at("### Travel Credit"));
    expect(at("### Travel Credit")).toBeLessThan(at("### Hilton Credit"));
    expect(at("### Hilton Credit")).toBeLessThan(at("### Flight Credit"));
    expect(at("### Flight Credit")).toBeLessThan(at("### Annual Hotel Credit"));
    // Used-up credits get their own section after the open ones.
    expect(at("### Annual Hotel Credit")).toBeLessThan(at("## Used up"));
    expect(at("## Used up")).toBeLessThan(at("### Hotel Credit (FHR"));
  });

  test("statuses, renewal date, and the stopped-tracking note", () => {
    const md = renderAgentMarkdown(sampleDashboard(), GENERATED_AT);
    expect(md).toContain("$50 credit · $0 used · $50 remaining · available");
    expect(md).toContain("$50 credit · $20 used · $30 remaining · partially used");
    expect(md).toContain("$300 credit · $300 used · $0 remaining · used up · renews 2027-01-01");
    // The inactive Saks credit is excluded and called out in the summary.
    expect(md).not.toContain("Saks Credit");
    expect(md).toContain('Not shown: 1 credit marked "stop tracking"');
  });

  test("usage rules, enrollment gaps, card labels, and posting sources", () => {
    const md = renderAgentMarkdown(sampleDashboard(), GENERATED_AT);
    // Catalog notes ride along so an assistant can advise how to redeem.
    expect(md).toContain("How to use: Flights booked directly with airlines or Amex Travel");
    expect(md).toContain("NOT automatic — request it via J.P. Morgan Priority Services");
    expect(md).toContain("How to use: Hotel bookings through Chase Travel only");
    expect(md).toContain("Enrollment: not enrolled yet — enroll before using");
    // Card identity: owner login label + product name + mask.
    expect(md).toContain("### Travel Credit — Alex · The Ritz-Carlton® Credit Card ··9999");
    expect(md).toContain("### Flight Credit — Sam · Hilton Honors Aspire Card ··2222");
    // Posting provenance: Plaid imports vs manual entries, and the posted
    // date is annotated when it differs from the transaction date.
    expect(md).toContain('2026-10-03 "AMEX Flight Credit" $20 (Plaid)');
    expect(md).toContain('2026-03-05 "Manual entry" $100 (manual entry)');
    expect(md).toContain('2026-09-30 "Platinum Hotel Credit" $300 (Plaid) · posted 2026-10-02');
    expect(md).toContain("- Postings this period: none yet");
  });

  test("amounts expiring at the same nearest boundary are summed", () => {
    const dash = sampleDashboard();
    dash.credits = [
      credit({ id: 1, currentRemaining: 10 }), // Wireless, ends 2026-10-31
      credit({
        id: 2,
        accountName: "Marriott Bonvoy Brilliant® Card",
        mask: "4444",
        name: "Dining Credit",
        amount: 25,
        currentRemaining: 25,
        periodLabel: "October 2026",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        nextPeriodStart: "2026-11-01",
        daysLeft: 16,
      }),
    ];
    dash.totals = { remainingNow: 35, expiring14: 0, expiring31: 35, openCredits: 2 };
    const md = renderAgentMarkdown(dash, GENERATED_AT);
    expect(md).toContain("Total unused in current periods: $35 across 2 open credits");
    expect(md).toContain("Expiring soonest: $35 on 2026-10-31 (2 credits)");
  });
});

describe("getAgentMarkdown action", () => {
  test("renders the same aggregated state as getDashboard", async () => {
    const db = createTestDb();
    const ctx = fakeCtx(db);
    const today = todayLA();
    const quarterStart = periodBounds("quarterly", today).start;
    const quarterEnd = periodBounds("quarterly", today).end;
    const halfStart = periodBounds("semiannual", today).start;
    await Actions.importSnapshot.handler(ctx, {
      complete: true,
      windowStart: halfStart,
      windowEnd: today,
      accounts: [ALEX_ASPIRE, SAM_ASPIRE],
      postings: [
        { txnId: "fake-md-alex-flight", accountPlaidId: ALEX_ASPIRE.plaidAccountId, date: quarterStart, name: "AMEX Flight Credit", amount: 50 },
        { txnId: "fake-md-sam-flight", accountPlaidId: SAM_ASPIRE.plaidAccountId, date: quarterStart, name: "AMEX Flight Credit", amount: 20 },
        { txnId: "fake-md-sam-resort", accountPlaidId: SAM_ASPIRE.plaidAccountId, date: halfStart, name: "Hilton", amount: 200 },
      ],
    } as any);
    await Actions.setOwnerLabels.handler(ctx, { aLabel: "Alex", bLabel: "Sam" });

    const dash: any = await Actions.getDashboard.handler(ctx, {});
    const res: any = await Actions.getAgentMarkdown.handler(ctx, {});
    const md: string = res.markdown;

    expect(typeof md).toBe("string");
    expect(Number.isNaN(Date.parse(res.generatedAt))).toBe(false);
    expect(md).toContain("# Credit Card Coupon Book");
    // Same totals as the JSON dashboard: Alex resort $200 + Sam flight $30.
    expect(dash.totals.remainingNow).toBe(230);
    expect(md).toContain("Total unused in current periods: $230 across 2 open credits");
    // Labels, rules, and Plaid provenance come through end to end.
    expect(md).toContain("Alex · Hilton Honors Aspire Card ··1111");
    expect(md).toContain("Sam · Hilton Honors Aspire Card ··2222");
    expect(md).toContain("How to use: Flights booked directly with airlines or Amex Travel");
    expect(md).toContain("(Plaid)");
    // Open credits first; used-up ones (with renewal dates) in their section.
    const renews = addDays(quarterEnd, 1);
    expect(md).toContain(`used up · renews ${renews}`);
    expect(md.indexOf("Flight Credit — Sam")).toBeLessThan(md.indexOf("## Used up"));
    expect(md.indexOf("## Used up")).toBeLessThan(md.indexOf("Flight Credit — Alex"));
  });
});
