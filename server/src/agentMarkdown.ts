// Agent-friendly markdown export of the dashboard state.
//
// renderAgentMarkdown turns the dashboard aggregation (computeDashboard in
// actions.ts — the exact same numbers the UI displays) into one compact
// markdown document the user can paste to an AI assistant (e.g. Muse) and
// immediately discuss: what is still unused, what expires soonest, how each
// credit is redeemed, and where each number came from. It is a pure function
// of the dashboard data, so it is unit-tested with fictional fixtures.

import type { DashboardData } from "./actions";

type Credit = DashboardData["credits"][number];

/** Plain dollar amount: $50, $20.50, $1,234 — never $50.00. */
export function money(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const body = Number.isInteger(rounded)
    ? rounded.toLocaleString("en-US")
    : rounded.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
  return `$${body}`;
}

function statusOf(c: Credit): string {
  if (c.currentRemaining <= 0) return `used up · renews ${c.nextPeriodStart}`;
  return c.currentUsed > 0 ? "partially used" : "available";
}

/** "Alex · Hilton Honors Aspire Card ··1111" (owner / mask omitted when absent). */
function cardLabel(c: Credit): string {
  const parts: string[] = [];
  if (c.owner) parts.push(c.owner);
  parts.push(c.accountName);
  return c.mask ? `${parts.join(" · ")} ··${c.mask}` : parts.join(" · ");
}

function creditBlock(c: Credit): string {
  const lines: string[] = [`### ${c.name} — ${cardLabel(c)}`];
  const days =
    c.daysLeft <= 0
      ? "ends today"
      : `${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} left`;
  lines.push(`- Period: ${c.periodStart} to ${c.periodEnd} (${c.periodLabel}) · ${days}`);
  lines.push(
    `- ${money(c.amount)} credit · ${money(c.currentUsed)} used · ${money(c.currentRemaining)} remaining · ${statusOf(c)}`,
  );
  if (!c.enrolled) lines.push("- Enrollment: not enrolled yet — enroll before using");
  // The catalog note is the usage rule (how to redeem, trigger conditions,
  // manual-claim steps) — the part that lets an assistant advise, not just
  // report numbers.
  if (c.note) lines.push(`- How to use: ${c.note}`);
  if (c.currentPostings.length > 0) {
    lines.push("- Postings this period:");
    for (const p of c.currentPostings) {
      const src = p.source === "manual" ? "manual entry" : "Plaid";
      const posted = p.postedDate !== p.date ? ` · posted ${p.postedDate}` : "";
      lines.push(`  - ${p.date} "${p.name}" ${money(p.amount)} (${src})${posted}`);
    }
  } else {
    lines.push("- Postings this period: none yet");
  }
  return lines.join("\n");
}

export function renderAgentMarkdown(data: DashboardData, generatedAt: Date): string {
  const tracked = data.credits.filter((c) => c.active);
  const stoppedCount = data.credits.length - tracked.length;
  // Urgency first: credits that still have money sort by nearest period end
  // (largest remaining first on ties); used-up credits follow, also by
  // period end. Mirrors the dashboard action list's own ordering.
  const sorted = [...tracked].sort((a, b) => {
    const aDone = a.currentRemaining <= 0 ? 1 : 0;
    const bDone = b.currentRemaining <= 0 ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (a.periodEnd !== b.periodEnd) return a.periodEnd < b.periodEnd ? -1 : 1;
    return b.currentRemaining - a.currentRemaining;
  });
  const open = sorted.filter((c) => c.currentRemaining > 0);
  const usedUp = sorted.filter((c) => c.currentRemaining <= 0);

  const out: string[] = [];
  out.push("# Credit Card Coupon Book");
  out.push("");
  out.push(
    `Generated: ${generatedAt.toISOString()} · Current periods as of ${data.today}. ` +
      "Paste this file to your AI assistant to discuss your card credits.",
  );
  if (data.lastImportAt) out.push(`Postings last imported: ${data.lastImportAt}`);
  out.push("");
  out.push("## Summary");
  out.push("");
  out.push(
    `- Total unused in current periods: ${money(data.totals.remainingNow)} across ` +
      `${data.totals.openCredits} open credit${data.totals.openCredits === 1 ? "" : "s"}`,
  );
  const soonest = open[0];
  if (soonest) {
    const atBoundary = open.filter((c) => c.periodEnd === soonest.periodEnd);
    const amount = atBoundary.reduce((s, c) => s + c.currentRemaining, 0);
    out.push(
      `- Expiring soonest: ${money(amount)} on ${soonest.periodEnd} ` +
        `(${atBoundary.length} credit${atBoundary.length === 1 ? "" : "s"})`,
    );
  } else {
    out.push("- Expiring soonest: nothing — every tracked credit is used up");
  }
  if (stoppedCount > 0) {
    out.push(
      `- Not shown: ${stoppedCount} credit${stoppedCount === 1 ? "" : "s"} marked "stop tracking" in the dashboard`,
    );
  }
  out.push("");
  out.push("## Credits — most urgent first");
  out.push("");
  if (open.length === 0) {
    out.push("No unused credits in the current periods.");
    out.push("");
  } else {
    for (const c of open) {
      out.push(creditBlock(c));
      out.push("");
    }
  }
  if (usedUp.length > 0) {
    out.push("## Used up — renewing next period");
    out.push("");
    for (const c of usedUp) {
      out.push(creditBlock(c));
      out.push("");
    }
  }
  return `${out.join("\n").trimEnd()}\n`;
}
