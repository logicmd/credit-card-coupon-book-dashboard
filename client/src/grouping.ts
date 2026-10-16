// Grouping of same-type credits across cards, extracted from App.tsx so the
// pure aggregation logic can be unit-tested without pulling in React.
//
// Credits of the same type on different cards (same name, same period, same
// current period window) collapse into one group with combined totals; the
// per-card rows stay available inside the expanded group.

export type CreditPeriod = "monthly" | "quarterly" | "semiannual" | "annual";

/** The credit fields the grouping logic reads. Dashboard credits satisfy this structurally. */
export type GroupableCredit = {
  name: string;
  period: CreditPeriod;
  periodLabel: string;
  periodEnd: string;
  daysLeft: number;
  amount: number;
  currentUsed: number;
  currentRemaining: number;
  owner: string | null;
  /** true/false once the user asserted it; null while enrollment is unconfirmed. */
  enrolled: boolean | null;
  /** Catalog fact: this benefit pays out only after enrollment. */
  enrollmentRequired: boolean;
};

export type CreditGroup<C extends GroupableCredit = GroupableCredit> = {
  key: string;
  name: string;
  /** Distinct logins this combined entry spans (both logins), shown together. */
  owners: string[];
  period: CreditPeriod;
  periodLabel: string;
  periodEnd: string;
  daysLeft: number;
  amount: number;
  used: number;
  remaining: number;
  /** Members the user marked NOT enrolled. */
  notEnrolled: number;
  /** Members whose enrollment state is unconfirmed (never asserted). */
  enrollmentUnconfirmed: number;
  members: C[];
};

export function groupCredits<C extends GroupableCredit>(credits: readonly C[]): CreditGroup<C>[] {
  const byKey = new Map<string, CreditGroup<C>>();
  for (const c of credits) {
    // One combined entry per credit type across BOTH logins (the totals rows
    // must not split the two logins apart). Which login each card belongs to
    // shows inside the expanded entry, on the per-card rows.
    const key = `${c.name.trim().toLowerCase()}|${c.period}|${c.periodLabel}`;
    const g = byKey.get(key);
    if (g) {
      g.members.push(c);
      g.amount += c.amount;
      g.used += c.currentUsed;
      g.remaining += c.currentRemaining;
      g.daysLeft = Math.min(g.daysLeft, c.daysLeft);
      if (c.owner && !g.owners.includes(c.owner)) g.owners.push(c.owner);
      if (c.enrolled === false) g.notEnrolled += 1;
      if (c.enrolled === null && c.enrollmentRequired) g.enrollmentUnconfirmed += 1;
    } else {
      byKey.set(key, {
        key,
        name: c.name,
        owners: c.owner ? [c.owner] : [],
        period: c.period,
        periodLabel: c.periodLabel,
        periodEnd: c.periodEnd,
        daysLeft: c.daysLeft,
        amount: c.amount,
        used: c.currentUsed,
        remaining: c.currentRemaining,
        notEnrolled: c.enrolled === false ? 1 : 0,
        enrollmentUnconfirmed: c.enrolled === null && c.enrollmentRequired ? 1 : 0,
        members: [c],
      });
    }
  }
  const groups = [...byKey.values()];
  for (const g of groups) {
    g.amount = Math.round(g.amount * 100) / 100;
    g.used = Math.round(g.used * 100) / 100;
    g.remaining = Math.round(g.remaining * 100) / 100;
    g.members.sort((a, b) => b.currentRemaining - a.currentRemaining);
  }
  groups.sort((a, b) => {
    const aDone = a.remaining <= 0 ? 1 : 0;
    const bDone = b.remaining <= 0 ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    return b.remaining - a.remaining;
  });
  return groups;
}
