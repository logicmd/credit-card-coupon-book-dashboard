// Actions for the Amex Credits Dashboard.
//
// Data model: Plaid (via the connector CLI, read by an agent task or by the
// initial seed import) supplies card accounts and the actual statement-credit
// postings the issuer paid out. Usage is computed ONLY from those postings — never
// inferred from merchant spending. The credit catalog (amount + calendar
// period per card product) is seeded on first import and fully editable.

import { defineAction, z, type ActionsModule, type SpaceDb } from "@hatch/space-sdk";
import { asc, desc, eq, isNull } from "drizzle-orm";
import * as schema from "./schema";
import { renderAgentMarkdown } from "./agentMarkdown";

// ---------------------------------------------------------------------------
// Catalog seed: current published Amex benefit terms per card product.
// Every row is a default the user can edit (amount, period, enrolled, active).
// ---------------------------------------------------------------------------

export type Period = "monthly" | "quarterly" | "semiannual" | "annual";
type CreditDef = {
  name: string;
  amount: number;
  period: Period;
  pattern: string;
  note?: string;
  /**
   * True when the issuer requires enrolling in the benefit before use:
   * the credit pays out only after enrollment. This is a catalog fact
   * about the benefit — distinct from the per-row `enrolled` state the
   * user tracks — and it drives the enrollment notice in the credit's
   * expanded detail (dashboard UI and Agent Markdown).
   */
  enrollmentRequired?: boolean;
  /**
   * The enrollment notice shown in the expanded detail when
   * enrollmentRequired is true (a full sentence, starting with
   * "Enrollment required:"). Falls back to DEFAULT_ENROLLMENT_NOTE.
   */
  enrollmentNote?: string;
  /**
   * Anniversary anchor for annual credits (e.g. 5/1): the credit year runs
   * anchor-to-anchor instead of Jan 1 – Dec 31. Only meaningful with
   * period "annual".
   */
  anchorMonth?: number;
  anchorDay?: number;
};

const BIZ_PLAT: CreditDef[] = [
  { name: "Hotel Credit (FHR / Hotel Collection)", amount: 300, period: "semiannual", pattern: "hotel credit", note: "Prepaid FHR or The Hotel Collection via Amex Travel; Hotel Collection needs 2+ nights" },
  { name: "Hilton Credit", amount: 50, period: "quarterly", pattern: "hilton", note: "Direct Hilton purchases; needs Hilton for Business enrollment", enrollmentRequired: true, enrollmentNote: "Enrollment required: enroll the card in Hilton for Business first — Hilton purchases count toward the credit only after enrollment" },
  { name: "Dell Credit", amount: 150, period: "annual", pattern: "dell", note: "Plus $1,000 more after $5,000 of Dell spend in the year" },
  { name: "Airline Fee Credit", amount: 200, period: "annual", pattern: "airline fee", note: "Incidentals on your one selected airline" },
  { name: "Wireless Credit", amount: 10, period: "monthly", pattern: "wireless", note: "U.S. wireless provider paid directly — your mobile phone bill credit" },
];

const PERSONAL_PLAT: CreditDef[] = [
  { name: "Hotel Credit (FHR / Hotel Collection)", amount: 300, period: "semiannual", pattern: "hotel credit", note: "Prepaid FHR or The Hotel Collection via Amex Travel; Hotel Collection needs 2+ nights" },
  { name: "Resy Credit", amount: 100, period: "quarterly", pattern: "resy", note: "U.S. Resy restaurants; enrollment required", enrollmentRequired: true },
  { name: "Lululemon Credit", amount: 75, period: "quarterly", pattern: "lululemon", note: "U.S. lululemon stores (excl. outlets) and online" },
  { name: "Airline Fee Credit", amount: 200, period: "annual", pattern: "airline fee", note: "Incidentals on your one selected airline" },
  { name: "Saks Credit", amount: 50, period: "semiannual", pattern: "saks", note: "Saks Fifth Avenue purchases" },
  { name: "Oura Ring Credit", amount: 200, period: "annual", pattern: "oura", note: "Oura Ring hardware only, via ouraring.com" },
  { name: "Uber One Credit", amount: 120, period: "annual", pattern: "uber one", note: "Auto-renewing Uber One membership paid with this card" },
];

const ASPIRE: CreditDef[] = [
  { name: "Flight Credit", amount: 50, period: "quarterly", pattern: "flight credit", note: "Flights booked directly with airlines or Amex Travel" },
  { name: "Hilton Resort Credit", amount: 200, period: "semiannual", pattern: "hilton", note: "At participating Hilton resorts. Amex runs this on a cardmember-year cycle; tracked here in calendar halves — edit the credit if your cycle differs" },
];

const BRILLIANT: CreditDef[] = [
  { name: "Dining Credit", amount: 25, period: "monthly", pattern: "dining", note: "Restaurants worldwide, up to $25 back per month" },
  { name: "Property Credit", amount: 300, period: "annual", pattern: "property credit", note: "Per cardmember year, on a 2+ night stay at St. Regis / Ritz-Carlton" },
];

const BIZ_GOLD: CreditDef[] = [
  { name: "Flexible Business Credit", amount: 20, period: "monthly", pattern: "flexible", note: "Grubhub, FedEx, and U.S. office supply stores — the $20/mo office supply credit" },
];

// ---------------------------------------------------------------------------
// Chase catalog: published benefit terms per Chase card product. Chase
// coupons mostly run on the cardmember anniversary year (anchored to the
// account anniversary, May 1 for these defaults — edit the credit's anchor
// if yours differs), not the calendar year.
// ---------------------------------------------------------------------------

const SAPPHIRE_PREFERRED: CreditDef[] = [
  { name: "Annual Hotel Credit", amount: 100, period: "annual", anchorMonth: 5, anchorDay: 1, pattern: "annual hotel credit", note: "Hotel bookings through Chase Travel only; runs on the cardmember anniversary year" },
];

const HYATT_BUSINESS: CreditDef[] = [
  // The statement credit posts under the generic name "CREDIT ADJUSTMENT".
  // Matching is always scoped to the account's own credits, so this pattern
  // only ever fires on this card.
  { name: "Hyatt Credit", amount: 100, period: "annual", anchorMonth: 5, anchorDay: 1, pattern: "credit adjustment", note: "$50 back per $50+ purchase at Hyatt properties, up to 2x per anniversary year" },
];

const IHG_PREMIER: CreditDef[] = [
  { name: "Airline Credit", amount: 100, period: "annual", pattern: "airline credit", note: "Posts when a single flight purchase of $250+ is made directly with the airline" },
];

const RITZ_CARLTON: CreditDef[] = [
  { name: "Travel Credit", amount: 300, period: "annual", pattern: "travel credit", note: "Airline incidentals only; NOT automatic — request it via J.P. Morgan Priority Services within 4 billing cycles of the purchase" },
];

// ---------------------------------------------------------------------------
// Non-seeded catalog credits: the benefit families the dashboard hides by
// default (ChatGPT Business, Indeed, Adobe, CLEAR+, Equinox, digital
// entertainment, Walmart+). These are real published benefits of the
// products below, but they are deliberately NOT part of the seeded catalogs
// above: import never writes rows for them, so import-time matching can
// never assign a posting to them (there is no row id to point at).
// Instead, computeDashboard synthesizes dashboard instances for them
// at read time (merged with stored rows — a stored row for the same
// account + name wins) and attributes unassigned postings to those
// instances by their match patterns, also at read time. That is what
// lets the exclusion preference name them in "Hidden by preference" and
// un-hide them on ANY deployment —
// including long-running ones whose accounts were imported before these
// families existed and therefore never materialized stored rows.
// ---------------------------------------------------------------------------

const BIZ_PLAT_NON_SEEDED: CreditDef[] = [
  { name: "ChatGPT Business Credit", amount: 300, period: "annual", pattern: "chatgpt", note: "ChatGPT Business subscription credit; each business card enrolls separately", enrollmentRequired: true, enrollmentNote: "Enrollment required: each card must be enrolled in the ChatGPT Business credit separately — a card's credit only pays out after that card is enrolled" },
  { name: "Indeed Credit", amount: 200, period: "annual", pattern: "indeed", note: "U.S. purchases with Indeed" },
  { name: "Adobe Credit", amount: 150, period: "annual", pattern: "adobe", note: "Adobe Creative Cloud / Acrobat purchases" },
];

const BIZ_GOLD_NON_SEEDED: CreditDef[] = [
  { name: "ChatGPT Business Credit", amount: 300, period: "annual", pattern: "chatgpt", note: "ChatGPT Business subscription credit; each business card enrolls separately", enrollmentRequired: true, enrollmentNote: "Enrollment required: each card must be enrolled in the ChatGPT Business credit separately — a card's credit only pays out after that card is enrolled" },
];

const PERSONAL_PLAT_NON_SEEDED: CreditDef[] = [
  { name: "CLEAR+ Credit", amount: 209, period: "annual", pattern: "clear", note: "CLEAR+ membership charges" },
  { name: "Equinox Credit", amount: 300, period: "annual", pattern: "equinox", note: "Equinox club memberships and the Equinox+ app; enrollment required", enrollmentRequired: true },
  { name: "Digital Entertainment Credit", amount: 25, period: "monthly", pattern: "entertainment", note: "Monthly credit across the eligible streaming services; enrollment required", enrollmentRequired: true },
  { name: "Walmart+ Credit", amount: 12.95, period: "monthly", pattern: "walmart", note: "Monthly Walmart+ membership fee; enrollment required", enrollmentRequired: true },
];

/**
 * The non-seeded (synthesis-only) catalog credits for a card product,
 * using the same product detection order as catalogFor. Returns [] for
 * products that carry none of the default-hidden families.
 */
export function nonSeededDefsFor(accountName: string): CreditDef[] {
  const n = accountName.toLowerCase();
  if (n.includes("business platinum")) return BIZ_PLAT_NON_SEEDED;
  if (n.includes("business gold")) return BIZ_GOLD_NON_SEEDED;
  if (n.includes("platinum")) return PERSONAL_PLAT_NON_SEEDED;
  return [];
}

// ---------------------------------------------------------------------------
// Display preferences:
// - Hidden credits: a stored user preference (meta key `excludedCredits`,
//   a JSON list of lowercase name patterns). A credit whose name contains
//   any pattern (case-insensitive substring) is filtered out of the
//   dashboard list and out of every total. Stored rows stay in the DB
//   (their postings stay assigned, so nothing leaks into Unassigned);
//   credits with no stored row are synthesized at read time (see
//   computeDashboard), so un-hiding restores either kind exactly. When
//   the preference has never been set,
//   DEFAULT_EXCLUDED_PATTERNS applies — the built-in list covering
//   ChatGPT Business, Indeed, Adobe, CLEAR+, Equinox, digital
//   entertainment, Walmart+, and Instacart. Once the user saves their own selection
//   (including an empty one = show everything), it is authoritative and
//   the built-in list never applies again.
//   The list is NOT hardcoded: the dashboard page has a Display settings
//   section with a toggle per hideable family (HIDEABLE_FAMILIES), and
//   the user's assistant can also change it from chat. Both paths go
//   through the same getPreferences / setExcludedCredits actions and the
//   same stored preference — there is no second storage path.
// - Always display: Business Gold Flexible Business Credit ($20/mo, office
//   supply) and Business Platinum Wireless Credit ($10/mo, mobile phone
//   bill). These are pinned active in the dashboard view even if an earlier
//   "stop tracking" toggled them off.
// ---------------------------------------------------------------------------

/** Meta key holding the exclusion preference (JSON array of patterns). */
export const EXCLUDED_CREDITS_META_KEY = "excludedCredits";

/** Built-in exclusion list, in force until the user stores a preference. */
export const DEFAULT_EXCLUDED_PATTERNS = [
  "chatgpt",
  "indeed",
  "adobe",
  "clear",
  "equinox",
  "entertainment",
  "walmart",
  "instacart",
];

/**
 * The credit families the user can hide or show: the canonical toggle
 * list behind the dashboard's Display settings section. `pattern` is the
 * exclusion entry toggling the family on writes into the preference;
 * `label` is the human-readable credit name shown next to the toggle.
 * The first eight are the families the built-in defaults hide; the rest
 * start out shown but can be hidden the same way.
 * setExcludedCredits validation accepts an entry when it matches one of
 * these labels (or a catalog / stored credit name).
 */
export const HIDEABLE_FAMILIES: { pattern: string; label: string }[] = [
  { pattern: "chatgpt", label: "ChatGPT Business Credit" },
  { pattern: "indeed", label: "Indeed Credit" },
  { pattern: "adobe", label: "Adobe Credit" },
  { pattern: "clear", label: "CLEAR+ Credit" },
  { pattern: "equinox", label: "Equinox Credit" },
  { pattern: "entertainment", label: "Digital Entertainment Credit" },
  { pattern: "walmart", label: "Walmart+ Credit" },
  { pattern: "instacart", label: "Instacart Credit" },
  { pattern: "global entry", label: "Global Entry Credit" },
  { pattern: "farelock", label: "FareLock Credit" },
];

/** Canonical display names of the hideable families (derived, see above). */
export const HIDEABLE_CREDIT_NAMES = HIDEABLE_FAMILIES.map((f) => f.label);

/** Every credit name in the built-in catalogs (all products). */
const ALL_CATALOG_CREDIT_NAMES: string[] = [
  BIZ_PLAT,
  PERSONAL_PLAT,
  ASPIRE,
  BRILLIANT,
  BIZ_GOLD,
  SAPPHIRE_PREFERRED,
  HYATT_BUSINESS,
  IHG_PREMIER,
  RITZ_CARLTON,
].flatMap((defs) => defs.map((d) => d.name));

export function isExcludedName(
  name: string,
  patterns: readonly string[] = DEFAULT_EXCLUDED_PATTERNS,
): boolean {
  const n = name.toLowerCase();
  return patterns.some((p) => p !== "" && n.includes(p));
}

/**
 * Parse the stored exclusion preference. Returns null when it was never
 * set (or is unreadable) — the caller then falls back to
 * DEFAULT_EXCLUDED_PATTERNS. A stored empty array is meaningful (the user
 * un-hid everything) and returns [].
 */
export function parseExcludedPatterns(
  raw: string | null | undefined,
): string[] | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const out: string[] = [];
    for (const v of parsed) {
      if (typeof v !== "string") return null;
      const p = v.trim().toLowerCase();
      if (p !== "" && !out.includes(p)) out.push(p);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Whether an exclusion entry plausibly names a real credit: it must share
 * a substring relationship (either way) with a known credit name, so a
 * typo or an invented name is rejected while both the short pattern
 * ("chatgpt") and the full name ("ChatGPT Business Credit") are accepted.
 * Entries under 3 characters match almost everything and are never valid.
 */
export function isKnownExclusionEntry(
  entry: string,
  knownNames: readonly string[],
): boolean {
  const e = entry.trim().toLowerCase();
  if (e.length < 3) return false;
  return knownNames.some((n) => {
    const name = n.toLowerCase();
    return name.includes(e) || e.includes(name);
  });
}

export function isPinnedCredit(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("flexible business") || n.includes("wireless");
}

// ---------------------------------------------------------------------------
// Login ownership: the two Plaid Amex logins are two different master
// accounts (for example, two people in one household). Accounts store an
// owner KEY — "A" for the first login, "B" for the second — never a name.
// The display labels for the keys come from the meta settings `ownerALabel`
// and `ownerBLabel` (defaults "Login 1" / "Login 2"; editable via the
// setOwnerLabels action), so nothing person-specific is baked into the
// code or the database. A stored value that is not a known key is already
// a label and is shown verbatim.
// ---------------------------------------------------------------------------

export const DEFAULT_OWNER_LABELS: [string, string] = ["Login 1", "Login 2"];

export function ownerLabelFor(
  ownerKey: string | null,
  labels: [string, string],
): string | null {
  if (ownerKey == null || ownerKey === "") return null;
  if (ownerKey === "A") return labels[0];
  if (ownerKey === "B") return labels[1];
  return ownerKey;
}

export function catalogFor(accountName: string): CreditDef[] | null {  const n = accountName.toLowerCase();
  // Chase products first: their names never contain the Amex product
  // keywords below, but checking them first keeps the issuers unambiguous.
  if (n.includes("sapphire preferred")) return SAPPHIRE_PREFERRED;
  if (n.includes("world of hyatt") && n.includes("business")) return HYATT_BUSINESS;
  if (n.includes("ihg") && n.includes("premier")) return IHG_PREMIER;
  if (n.includes("ritz-carlton")) return RITZ_CARLTON;
  if (n.includes("business platinum")) return BIZ_PLAT;
  if (n.includes("aspire")) return ASPIRE;
  if (n.includes("brilliant")) return BRILLIANT;
  if (n.includes("business gold")) return BIZ_GOLD;
  if (n.includes("platinum")) return PERSONAL_PLAT; // incl. co-branded Platinum variants
  return null;
}

/** Enrollment notice for defs that set enrollmentRequired without their own enrollmentNote. */
export const DEFAULT_ENROLLMENT_NOTE =
  "Enrollment required: enroll this card in the benefit first — the credit only pays out after enrollment.";

/**
 * Catalog enrollment metadata for one credit instance: whether the
 * issuer requires enrolling in the benefit before use, and the notice
 * the expanded detail should show. Resolved from the catalog defs by
 * (account product, credit name) so a stored row and a synthesized
 * instance of the same credit report it identically. A credit whose
 * name matches no def on the account's product (e.g. a user-created
 * row) reports not-required.
 */
export function enrollmentInfoFor(
  accountName: string,
  creditName: string,
): { required: boolean; note: string | null } {
  const key = creditName.trim().toLowerCase();
  const defs = [
    ...(catalogFor(accountName) ?? []),
    ...nonSeededDefsFor(accountName),
  ];
  const def = defs.find((d) => d.name.trim().toLowerCase() === key);
  if (!def?.enrollmentRequired) return { required: false, note: null };
  return { required: true, note: def.enrollmentNote ?? DEFAULT_ENROLLMENT_NOTE };
}

/**
 * Auto-mapping rule for imported postings: the first of the account's
 * credits whose non-empty match pattern is a case-insensitive substring of
 * the posting name wins. Returns undefined when nothing matches (the
 * posting stays unassigned for manual review).
 */
export function matchCreditForPosting<T extends { matchPattern: string }>(
  credits: readonly T[],
  postingName: string,
): T | undefined {
  const lower = postingName.toLowerCase();
  return credits.find(
    (c) => c.matchPattern !== "" && lower.includes(c.matchPattern.toLowerCase()),
  );
}

/** Issuer ("Amex" / "Chase") for a card, inferred from its product name. */
export function issuerForAccountName(accountName: string): string {
  const n = accountName.toLowerCase();
  if (
    n.includes("chase") ||
    n.includes("sapphire") ||
    n.includes("ritz-carlton") ||
    n.includes("ihg") ||
    n.includes("world of hyatt")
  ) {
    return "Chase";
  }
  return "Amex";
}

/**
 * Duplicate-account detection key: two Plaid records with the same card
 * name, the same non-zero balance, and the same credit limit are two views
 * of one underlying account (e.g. the primary card and a supplementary
 * card record seen from both logins). Returns null when the balance is
 * missing or zero — such records are never auto-flagged as duplicates.
 */
export function accountDuplicateKey(
  name: string,
  balance: number | null | undefined,
  creditLimit: number | null | undefined,
): string | null {
  if (balance == null || balance === 0) return null;
  return `${name}|${balance}|${creditLimit ?? ""}`;
}

// ---------------------------------------------------------------------------
// Calendar-period math (America/Los_Angeles calendar dates, YYYY-MM-DD).
// ---------------------------------------------------------------------------

function todayLA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseDate(s: string): { y: number; m: number; d: number } {
  const [y = 1970, m = 1, d = 1] = s.split("-").map(Number);
  return { y, m, d };
}

function fmt(y: number, m: number, d: number): string {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type Bounds = { start: string; end: string; key: string; label: string };

/** Anniversary anchor (month/day) for an annual credit's cycle. */
export type Anchor = { month: number; day: number };

export function periodBounds(period: Period, dateStr: string, anchor?: Anchor | null): Bounds {
  const { y, m } = parseDate(dateStr);
  if (period === "annual" && anchor) {
    // Anniversary-anchored year: runs from this year's anchor date through
    // the day before next year's anchor date (May 1 2026 – Apr 30 2027).
    const anchorDayThisYear = Math.min(anchor.day, daysInMonth(y, anchor.month));
    const startsThisYear = dateStr >= fmt(y, anchor.month, anchorDayThisYear);
    const startY = startsThisYear ? y : y - 1;
    const start = fmt(startY, anchor.month, Math.min(anchor.day, daysInMonth(startY, anchor.month)));
    const nextAnchor = fmt(
      startY + 1,
      anchor.month,
      Math.min(anchor.day, daysInMonth(startY + 1, anchor.month)),
    );
    const end = addDays(nextAnchor, -1);
    const endParts = parseDate(end);
    return {
      start,
      end,
      key: `${startY}-A${String(anchor.month).padStart(2, "0")}${String(anchor.day).padStart(2, "0")}`,
      label: `${MONTH_NAMES[anchor.month - 1] ?? ""} ${startY} – ${MONTH_NAMES[endParts.m - 1] ?? ""} ${endParts.y}`,
    };
  }
  if (period === "monthly") {
    return {
      start: fmt(y, m, 1),
      end: fmt(y, m, daysInMonth(y, m)),
      key: `${y}-${String(m).padStart(2, "0")}`,
      label: `${MONTH_NAMES[m - 1] ?? ""} ${y}`,
    };
  }
  if (period === "quarterly") {
    const q = Math.floor((m - 1) / 3); // 0..3
    const sm = q * 3 + 1;
    const em = sm + 2;
    return {
      start: fmt(y, sm, 1),
      end: fmt(y, em, daysInMonth(y, em)),
      key: `${y}-Q${q + 1}`,
      label: `Q${q + 1} ${y}`,
    };
  }
  if (period === "semiannual") {
    const first = m <= 6;
    const sm = first ? 1 : 7;
    const em = first ? 6 : 12;
    return {
      start: fmt(y, sm, 1),
      end: fmt(y, em, daysInMonth(y, em)),
      key: `${y}-H${first ? 1 : 2}`,
      label: first ? `Jan–Jun ${y}` : `Jul–Dec ${y}`,
    };
  }
  return { start: fmt(y, 1, 1), end: fmt(y, 12, 31), key: `${y}`, label: `${y}` };
}

export function daysBetween(a: string, b: string): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  const ua = Date.UTC(pa.y, pa.m - 1, pa.d);
  const ub = Date.UTC(pb.y, pb.m - 1, pb.d);
  return Math.round((ub - ua) / 86400000);
}

export function addDays(dateStr: string, delta: number): string {
  const { y, m, d } = parseDate(dateStr);
  const t = new Date(Date.UTC(y, m - 1, d) + delta * 86400000);
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * The date a posting counts toward: its transaction date (Plaid
 * `authorized_date`) when known, otherwise its posted date. Period
 * bucketing ALWAYS uses this — never the raw posted date.
 */
export function transactionDateOf(p: {
  date: string;
  transactionDate?: string | null;
}): string {
  return p.transactionDate ?? p.date;
}

/** LA calendar date (YYYY-MM-DD) of an ISO timestamp, or null if unparseable. */
export function laDateOf(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// ---------------------------------------------------------------------------
// Shared zod shapes
// ---------------------------------------------------------------------------

const periodEnum = z.enum(["monthly", "quarterly", "semiannual", "annual"]);

const creditView = z.object({
  id: z.number(),
  accountId: z.number(),
  accountName: z.string(),
  mask: z.string(),
  owner: z.string().nullable(),
  name: z.string(),
  amount: z.number(),
  period: periodEnum,
  /** Anniversary anchor for annual credits; null for calendar-cycle credits. */
  anchorMonth: z.number().nullable(),
  anchorDay: z.number().nullable(),
  enrolled: z.boolean(),
  /**
   * Catalog fact: the issuer requires enrolling in this benefit before
   * use. Independent of the row's `enrolled` state above.
   */
  enrollmentRequired: z.boolean(),
  /** Enrollment notice for the expanded detail; null unless enrollmentRequired. */
  enrollmentNote: z.string().nullable(),
  active: z.boolean(),
  note: z.string(),
  matchPattern: z.string(),
  currentUsed: z.number(),
  currentRemaining: z.number(),
  periodLabel: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  /** First day of the next period — when a used-up credit renews. */
  nextPeriodStart: z.string(),
  daysLeft: z.number(),
  currentPostings: z.array(
    z.object({
      id: z.number(),
      /** Transaction date (authorized_date) — the date the posting counts toward. */
      date: z.string(),
      /** Posted date (when the credit hit the statement); equals `date` unless they differ. */
      postedDate: z.string(),
      name: z.string(),
      amount: z.number(),
      /** Where this posting came from: imported from Plaid, or recorded manually. */
      source: z.enum(["plaid", "manual"]),
    }),
  ),
});

const dashboardResponse = z.object({
  lastImportAt: z.string().nullable(),
  /** Display labels for the two Amex logins (owner keys "A" and "B"). */
  ownerLabels: z.tuple([z.string(), z.string()]),
  /**
   * Effective display-exclusion patterns in force: the stored preference
   * (meta `excludedCredits`) when set, otherwise the built-in defaults.
   */
  excludedPatterns: z.array(z.string()),
  /** Credit rows hidden by the exclusion preference — never counted in any total. */
  hiddenCredits: z.array(
    z.object({
      name: z.string(),
      accountName: z.string(),
      mask: z.string(),
      owner: z.string().nullable(),
    }),
  ),
  /**
   * Earliest date the stored postings cumulatively cover (YYYY-MM-DD).
   * Daily refreshes only fetch a trailing 30-day window, but stored data is
   * merge-only, so this stays at Jan 1 of the current year once bootstrapped.
   */
  dataCoverageStart: z.string().nullable(),
  /** Start of the window the most recent refresh fetched (YYYY-MM-DD). */
  lastRefreshWindowStart: z.string().nullable(),
  today: z.string(),
  accounts: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      mask: z.string(),
      issuer: z.string(),
      owner: z.string().nullable(),
      balance: z.number().nullable(),
      ignored: z.boolean(),
      hasCatalog: z.boolean(),
    }),
  ),
  credits: z.array(creditView),
  unassigned: z.array(
    z.object({
      id: z.number(),
      /** Transaction date (authorized_date) — the date the posting counts toward. */
      date: z.string(),
      /** Posted date; equals `date` unless they differ. */
      postedDate: z.string(),
      name: z.string(),
      amount: z.number(),
      accountId: z.number(),
      accountName: z.string(),
      mask: z.string(),
      owner: z.string().nullable(),
    }),
  ),
  totals: z.object({
    remainingNow: z.number(),
    expiring14: z.number(),
    expiring31: z.number(),
    openCredits: z.number(),
  }),
});

export type DashboardData = z.infer<typeof dashboardResponse>;

const okResponse = z.object({ ok: z.literal(true) });

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * The dashboard aggregation — the single place where current-period usage,
 * remaining amounts, and totals are computed. The getDashboard action (JSON
 * for the UI) and the getAgentMarkdown action (a markdown snapshot an AI
 * assistant can discuss) both read from this, so the two views can never
 * disagree. (Body indentation follows the action handler it came from.)
 */
async function computeDashboard(
  db: SpaceDb<typeof schema>,
): Promise<z.infer<typeof dashboardResponse>> {
  const today = todayLA();
      const [accountRows, creditRows, postingRows, metaRows] = await Promise.all([
        db.select().from(schema.accounts).orderBy(asc(schema.accounts.id)),
        db.select().from(schema.credits).orderBy(asc(schema.credits.sortOrder)),
        db.select().from(schema.postings).orderBy(desc(schema.postings.date)),
        db.select().from(schema.meta),
      ]);
      const lastImportAt = metaRows.find((r) => r.key === "lastImportAt")?.value ?? null;
      const ownerLabels: [string, string] = [
        metaRows.find((r) => r.key === "ownerALabel")?.value || DEFAULT_OWNER_LABELS[0],
        metaRows.find((r) => r.key === "ownerBLabel")?.value || DEFAULT_OWNER_LABELS[1],
      ];
      const dataCoverageStart =
        metaRows.find((r) => r.key === "dataCoverageStart")?.value ?? null;
      const lastRefreshWindowStart =
        metaRows.find((r) => r.key === "lastRefreshWindowStart")?.value ?? null;
      // Display-exclusion preference: the stored list when the user has
      // set one (Display settings toggles or their assistant in chat),
      // otherwise the built-in defaults.
      const excludedPatterns =
        parseExcludedPatterns(
          metaRows.find((r) => r.key === EXCLUDED_CREDITS_META_KEY)?.value,
        ) ?? DEFAULT_EXCLUDED_PATTERNS;

      const accountById = new Map(accountRows.map((a) => [a.id, a]));
      const postingsByCredit = new Map<number, typeof postingRows>();
      for (const p of postingRows) {
        if (p.creditId == null) continue;
        const arr = postingsByCredit.get(p.creditId) ?? [];
        arr.push(p);
        postingsByCredit.set(p.creditId, arr);
      }

      // Compute-time synthesis of catalog credit instances (NO database
      // writes): for every account in the DB, each credit in the product's
      // full catalog — the seeded defs from catalogFor PLUS the non-seeded
      // families from nonSeededDefsFor — becomes an instance. Instances
      // are keyed by (accountId, credit name): a stored row with that key
      // wins and supplies the persisted state (edited amount / period /
      // active flag, and its postings via postingsByCredit); only defs
      // with no stored row are synthesized, with the catalog amount and
      // cycle. A synthesized instance starts with no postings of its own —
      // the attribution step below lends it the unassigned postings its
      // match pattern claims. This is what makes credits that
      // were never materialized as rows — the default-hidden families on
      // long-running deployments — listable by the exclusion preference
      // below and surfacable again by un-hiding, with no migration.
      // Synthesized instances carry deterministic negative ids so they
      // can never collide with a real row id (postings reference real ids).
      const storedNameByAccount = new Map<number, Set<string>>();
      for (const c of creditRows) {
        const names = storedNameByAccount.get(c.accountId) ?? new Set<string>();
        names.add(c.name.trim().toLowerCase());
        storedNameByAccount.set(c.accountId, names);
      }
      const synthesizedRows: (typeof creditRows)[number][] = [];
      let synthId = 0;
      for (const acct of accountRows) {
        const defs = [
          ...(catalogFor(acct.name) ?? []),
          ...nonSeededDefsFor(acct.name),
        ];
        if (defs.length === 0) continue;
        const have = storedNameByAccount.get(acct.id) ?? new Set<string>();
        defs.forEach((d, i) => {
          const key = d.name.trim().toLowerCase();
          if (have.has(key)) return;
          have.add(key);
          synthId -= 1;
          synthesizedRows.push({
            id: synthId,
            accountId: acct.id,
            name: d.name,
            amount: d.amount,
            period: d.period,
            anchorMonth: d.anchorMonth ?? null,
            anchorDay: d.anchorDay ?? null,
            matchPattern: d.pattern,
            enrolled: 1,
            active: 1,
            note: d.note ?? "",
            sortOrder: 10000 + i,
          });
        });
      }
      const effectiveCreditRows = [...creditRows, ...synthesizedRows];

      // Compute-time attribution for synthesized instances. A stored
      // credit receives its postings persistently: import auto-matches by
      // pattern, and the user can reassign (or deliberately unassign) by
      // hand. A synthesized instance has no row a posting could ever
      // point at — its id is a negative placeholder — so the ONLY way a
      // posting can count toward it is here, at read time: unassigned
      // postings are matched against the account's synthesized instances
      // with the same matchCreditForPosting rule import uses for stored
      // rows. A posting claimed this way counts toward that instance's
      // usage (bucketed by transaction date like any assigned posting)
      // and leaves the Unassigned list. Stored credits never participate:
      // a posting the user unassigned from a stored credit stays
      // unassigned, because persisted assignment is the user's state,
      // not something a read may override. Nothing is written back —
      // attribution is derived fresh on every read, exactly like
      // synthesis itself.
      const synthesizedByAccount = new Map<number, typeof synthesizedRows>();
      for (const row of synthesizedRows) {
        const arr = synthesizedByAccount.get(row.accountId) ?? [];
        arr.push(row);
        synthesizedByAccount.set(row.accountId, arr);
      }
      const effectivePostingsByCredit = new Map(postingsByCredit);
      const computeMatchedPostingIds = new Set<number>();
      for (const p of postingRows) {
        if (p.creditId != null) continue;
        const candidates = synthesizedByAccount.get(p.accountId);
        if (!candidates || candidates.length === 0) continue;
        const match = matchCreditForPosting(candidates, p.name);
        if (!match) continue;
        const arr = effectivePostingsByCredit.get(match.id) ?? [];
        arr.push(p);
        effectivePostingsByCredit.set(match.id, arr);
        computeMatchedPostingIds.add(p.id);
      }

      let remainingNow = 0;
      let expiring14 = 0;
      let expiring31 = 0;
      let openCredits = 0;

      const credits = effectiveCreditRows
        .filter((c) => {
          const acct = accountById.get(c.accountId);
          return acct && acct.ignored === 0 && !isExcludedName(c.name, excludedPatterns);
        })
        .map((c) => {
          const acct = accountById.get(c.accountId)!;
          const enrollment = enrollmentInfoFor(acct.name, c.name);
          const period = c.period as Period;
          const effectiveActive = c.active === 1 || isPinnedCredit(c.name);
          const anchor =
            c.anchorMonth != null && c.anchorDay != null
              ? { month: c.anchorMonth, day: c.anchorDay }
              : null;
          const bounds = periodBounds(period, today, anchor);
          const mine = effectivePostingsByCredit.get(c.id) ?? [];
          // Bucketing is by TRANSACTION date (authorized_date), never the
          // posted date: a credit authorized Sep 30 that posted Oct 2
          // counts in Q3, not Q4.
          const inPeriod = mine.filter((p) => {
            const td = transactionDateOf(p);
            return td >= bounds.start && td <= bounds.end;
          });
          const used = inPeriod.reduce((s, p) => s + p.amount, 0);
          const remaining = Math.max(0, Math.round((c.amount - used) * 100) / 100);
          const daysLeft = daysBetween(today, bounds.end);

          // Current period only: past periods are gone and are not tallied,
          // surfaced, or held against the user anywhere in this dashboard.
          if (effectiveActive) {
            remainingNow += remaining;
            if (daysLeft <= 14) expiring14 += remaining;
            if (daysLeft <= 31) expiring31 += remaining;
            if (remaining > 0) openCredits += 1;
          }

          return {
            id: c.id,
            accountId: c.accountId,
            accountName: acct.name,
            mask: acct.mask,
            owner: ownerLabelFor(acct.owner, ownerLabels),
            name: c.name,
            amount: c.amount,
            period,
            anchorMonth: c.anchorMonth,
            anchorDay: c.anchorDay,
            enrolled: c.enrolled === 1,
            enrollmentRequired: enrollment.required,
            enrollmentNote: enrollment.note,
            active: effectiveActive,
            note: c.note,
            matchPattern: c.matchPattern,
            currentUsed: Math.round(used * 100) / 100,
            currentRemaining: remaining,
            periodLabel: bounds.label,
            periodStart: bounds.start,
            periodEnd: bounds.end,
            nextPeriodStart: addDays(bounds.end, 1),
            daysLeft,
            currentPostings: inPeriod.map((p) => ({
              id: p.id,
              date: transactionDateOf(p),
              postedDate: p.date,
              name: p.name,
              amount: p.amount,
              source: p.source,
            })),
          };
        });

      const unassigned = postingRows
        .filter((p) => {
          if (p.creditId != null) return false;
          // Attributed at compute time to a synthesized instance (see
          // above): it counts as that credit's usage, so it is no longer
          // unassigned even though its stored creditId is still null.
          if (computeMatchedPostingIds.has(p.id)) return false;
          if (isExcludedName(p.name, excludedPatterns)) return false;
          const acct = accountById.get(p.accountId);
          return acct && acct.ignored === 0;
        })
        .slice(0, 100)
        .map((p) => {
          const acct = accountById.get(p.accountId)!;
          return {
            id: p.id,
            date: transactionDateOf(p),
            postedDate: p.date,
            name: p.name,
            amount: p.amount,
            accountId: p.accountId,
            accountName: acct.name,
            mask: acct.mask,
            owner: ownerLabelFor(acct.owner, ownerLabels),
          };
        });

      const creditCountByAccount = new Map<number, number>();
      for (const c of effectiveCreditRows) {
        creditCountByAccount.set(c.accountId, (creditCountByAccount.get(c.accountId) ?? 0) + 1);
      }

      // The credits the preference hides: surfaced by name (never tallied)
      // so the Agent Markdown can tell an assistant they exist and can be
      // re-enabled via chat. Drawn from the SAME effective instances as
      // the visible list (stored rows + synthesized catalog instances),
      // so a hidden credit with no stored row is still named — and
      // removing its pattern below surfaces the very same instance.
      const hiddenCredits = effectiveCreditRows
        .filter((c) => {
          const acct = accountById.get(c.accountId);
          return acct && acct.ignored === 0 && isExcludedName(c.name, excludedPatterns);
        })
        .map((c) => {
          const acct = accountById.get(c.accountId)!;
          return {
            name: c.name,
            accountName: acct.name,
            mask: acct.mask,
            owner: ownerLabelFor(acct.owner, ownerLabels),
          };
        })
        .sort((a, b) =>
          a.name === b.name
            ? a.accountName.localeCompare(b.accountName)
            : a.name.localeCompare(b.name),
        );

      return {
        lastImportAt,
        ownerLabels,
        excludedPatterns,
        hiddenCredits,
        dataCoverageStart,
        lastRefreshWindowStart,
        today,
        accounts: accountRows.map((a) => ({
          id: a.id,
          name: a.name,
          mask: a.mask,
          issuer: a.issuer,
          owner: ownerLabelFor(a.owner, ownerLabels),
          balance: a.balance,
          ignored: a.ignored === 1,
          hasCatalog: (creditCountByAccount.get(a.id) ?? 0) > 0,
        })),
        credits,
        unassigned,
        totals: {
          remainingNow: Math.round(remainingNow * 100) / 100,
          expiring14: Math.round(expiring14 * 100) / 100,
          expiring31: Math.round(expiring31 * 100) / 100,
          openCredits,
        },
      };
}

export const Actions = {
  getDashboard: defineAction({
    request: z.object({}),
    response: dashboardResponse,
    async handler(ctx): Promise<z.infer<typeof dashboardResponse>> {
      return computeDashboard(ctx.db<typeof schema>());
    },
  }),

  // Agent-friendly markdown snapshot of the very same aggregated state the
  // dashboard displays (via computeDashboard — no second set of math). The
  // user pastes it to their AI assistant, which can then discuss what to
  // use next with full context: amounts, period windows, usage rules, and
  // where each number came from.
  getAgentMarkdown: defineAction({
    request: z.object({}),
    response: z.object({ markdown: z.string(), generatedAt: z.string() }),
    async handler(ctx) {
      const data = await computeDashboard(ctx.db<typeof schema>());
      const generatedAt = new Date();
      return {
        markdown: renderAgentMarkdown(data, generatedAt),
        generatedAt: generatedAt.toISOString(),
      };
    },
  }),

  // MERGE-ONLY IMPORT — hard guarantee: a refresh fetches
  // only a trailing window (30 days for daily refreshes), yet the stored
  // dataset must keep covering the year from Jan 1. This action therefore
  // NEVER deletes or replaces stored data: accounts are upserted by Plaid
  // account id, postings are inserted only when their Plaid transaction id
  // is new, credits are only seeded for accounts that have none, and manual
  // postings / user edits are never touched. A posting that is absent from
  // the payload (e.g. it falls outside the fetched window) stays stored and
  // keeps counting. There is deliberately no delete/clear path here.
  // One in-place exception: re-importing a known transaction id MAY correct
  // its stored transactionDate (Plaid sometimes finalizes authorized_date
  // after the first read). The correction updates the date in place — it
  // never duplicates the posting and never touches its amount or mapping.
  importSnapshot: defineAction({
    request: z.object({
      /** Start of the window this payload was fetched over (YYYY-MM-DD). */
      windowStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      /** End of the window this payload was fetched over (YYYY-MM-DD). */
      windowEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      /**
       * True only when the source read covered the WHOLE window
       * successfully. Coverage (dataCoverageStart) is claimed from
       * windowStart only for complete fetches: a partial or failed read
       * still merges whatever it got (merge-only makes that safe) but must
       * not certify the window as covered, so the next refresh retries the
       * bootstrap / gap-fill window instead of moving on to 30-day windows.
       */
      complete: z.boolean().optional(),
      accounts: z.array(
        z.object({
          plaidAccountId: z.string().min(1),
          name: z.string().min(1),
          mask: z.string().default(""),
          balance: z.number().nullable().optional(),
          creditLimit: z.number().nullable().optional(),
          /** Which login this account belongs to, as a key: "A" or "B". */
          owner: z.string().optional(),
          /** Issuer ("Amex" / "Chase"); inferred from the card name when omitted. */
          issuer: z.string().optional(),
          /** Explicit duplicate flag from a curated import; wins over the heuristic. */
          ignored: z.boolean().optional(),
        }),
      ),
      postings: z.array(
        z.object({
          txnId: z.string().min(1),
          accountPlaidId: z.string().min(1),
          /** Posted date (Plaid `date`) — display only. */
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          /**
           * Transaction date (Plaid `authorized_date`) — the date the
           * posting counts toward. Falls back to the posted date when
           * absent. Re-importing a known txnId with a different
           * transactionDate corrects the stored value in place.
           */
          transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          name: z.string().min(1),
          amount: z.number().positive(),
        }),
      ),
      importedAt: z.string().optional(),
    }),
    response: z.object({
      accountsAdded: z.number(),
      postingsAdded: z.number(),
      postingsSkipped: z.number(),
      /** Known postings whose stored transactionDate was corrected in place. */
      postingsCorrected: z.number(),
      /** Postings already stored before this import — all of them are kept. */
      existingPostingsPreserved: z.number(),
      /** Earliest date the stored postings now cumulatively cover. */
      dataCoverageStart: z.string().nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const existingPostingsCount = (
        await db.select({ id: schema.postings.id }).from(schema.postings)
      ).length;
      const existingAccounts = await db.select().from(schema.accounts);
      const byPlaidId = new Map(existingAccounts.map((a) => [a.plaidAccountId, a]));

      // Duplicate detection: same card name + same non-zero balance + same
      // limit across the two logins = the same underlying account seen twice
      // (primary + supplementary views). New duplicates start ignored; the
      // user can un-ignore them in the Accounts section.
      const seenKey = new Map<string, number>();
      for (const a of existingAccounts) {
        const key = accountDuplicateKey(a.name, a.balance, a.creditLimit);
        if (key != null) seenKey.set(key, a.id);
      }

      let accountsAdded = 0;
      for (const a of args.accounts) {
        const owner = a.owner ?? null;
        const issuer = a.issuer ?? issuerForAccountName(a.name);
        const known = byPlaidId.get(a.plaidAccountId);
        if (known) {
          await db
            .update(schema.accounts)
            .set({
              balance: a.balance ?? known.balance,
              name: a.name,
              mask: a.mask,
              ...(a.issuer ? { issuer: a.issuer } : {}),
              ...(owner ? { owner } : {}),
              ...(a.ignored !== undefined ? { ignored: a.ignored ? 1 : 0 } : {}),
            })
            .where(eq(schema.accounts.id, known.id));
          continue;
        }
        let ignored = a.ignored ? 1 : 0;
        const dupKey = accountDuplicateKey(a.name, a.balance, a.creditLimit);
        if (!ignored && dupKey != null) {
          if (seenKey.has(dupKey)) ignored = 1;
          else seenKey.set(dupKey, -1);
        }
        const inserted = await db
          .insert(schema.accounts)
          .values({
            plaidAccountId: a.plaidAccountId,
            name: a.name,
            mask: a.mask,
            balance: a.balance ?? null,
            creditLimit: a.creditLimit ?? null,
            issuer,
            owner,
            ignored,
          })
          .returning({ id: schema.accounts.id });
        const row = inserted[0];
        if (!row) continue;
        accountsAdded++;
        const fresh = {
          id: row.id,
          plaidAccountId: a.plaidAccountId,
          name: a.name,
          mask: a.mask,
          balance: a.balance ?? null,
          creditLimit: a.creditLimit ?? null,
          issuer,
          owner,
          ignored,
          createdAt: new Date(),
        };
        byPlaidId.set(a.plaidAccountId, fresh);
        if (dupKey != null) seenKey.set(dupKey, row.id);
      }

      // Seed catalog credits for any account that has none yet.
      const allAccounts = await db.select().from(schema.accounts);
      const allCredits = await db.select().from(schema.credits);
      const creditsByAccount = new Map<number, typeof allCredits>();
      for (const c of allCredits) {
        const arr = creditsByAccount.get(c.accountId) ?? [];
        arr.push(c);
        creditsByAccount.set(c.accountId, arr);
      }
      for (const acct of allAccounts) {
        if ((creditsByAccount.get(acct.id) ?? []).length > 0) continue;
        const defs = catalogFor(acct.name);
        if (!defs) continue;
        const rows: (typeof schema.credits.$inferInsert)[] = defs.map((d, i) => ({
          accountId: acct.id,
          name: d.name,
          amount: d.amount,
          period: d.period,
          anchorMonth: d.anchorMonth ?? null,
          anchorDay: d.anchorDay ?? null,
          matchPattern: d.pattern,
          note: d.note ?? "",
          sortOrder: i,
        }));
        const insertedCredits = await db
          .insert(schema.credits)
          .values(rows)
          .returning();
        creditsByAccount.set(acct.id, insertedCredits);
      }

      // Import postings, deduped by Plaid transaction id, auto-mapped by
      // the account's catalog match patterns.
      const existingByTxn = new Map(
        (
          await db
            .select({
              id: schema.postings.id,
              txnId: schema.postings.txnId,
              date: schema.postings.date,
              transactionDate: schema.postings.transactionDate,
            })
            .from(schema.postings)
        )
          .filter((r): r is typeof r & { txnId: string } => r.txnId != null)
          .map((r) => [r.txnId, r] as const),
      );
      let postingsAdded = 0;
      let postingsSkipped = 0;
      let postingsCorrected = 0;
      for (const p of args.postings) {
        const knownPosting = existingByTxn.get(p.txnId);
        if (knownPosting) {
          // Already stored: never duplicate. The one allowed in-place fix
          // is the transaction date — if this read carries a different
          // authorized_date, correct the stored value so the posting moves
          // to the right period bucket.
          if (
            p.transactionDate !== undefined &&
            p.transactionDate !== transactionDateOf(knownPosting)
          ) {
            await db
              .update(schema.postings)
              .set({ transactionDate: p.transactionDate })
              .where(eq(schema.postings.id, knownPosting.id));
            postingsCorrected++;
          } else {
            postingsSkipped++;
          }
          continue;
        }
        const acct = byPlaidId.get(p.accountPlaidId);
        if (!acct) {
          postingsSkipped++;
          continue;
        }
        const match = matchCreditForPosting(creditsByAccount.get(acct.id) ?? [], p.name);
        const insertedPosting = await db
          .insert(schema.postings)
          .values({
            txnId: p.txnId,
            accountId: acct.id,
            creditId: match?.id ?? null,
            date: p.date,
            transactionDate: p.transactionDate ?? null,
            name: p.name,
            amount: p.amount,
            source: "plaid",
          })
          .returning({ id: schema.postings.id });
        const newRow = insertedPosting[0];
        if (newRow) {
          existingByTxn.set(p.txnId, {
            id: newRow.id,
            txnId: p.txnId,
            date: p.date,
            transactionDate: p.transactionDate ?? null,
          });
        }
        postingsAdded++;
      }

      // lastImportAt marks the last COMPLETE import. A windowed import that
      // did not complete (complete !== true) still merges its postings, but
      // must not move this marker: refreshCredits derives bootstrap /
      // gap-fill windows from it, and a partial read has to be retried, not
      // treated as done. Window-less imports (legacy/manual) keep the old
      // behavior of always marking.
      const certifiesComplete = args.windowStart == null || args.complete === true;
      if (certifiesComplete) {
        const importedAt = args.importedAt ?? new Date().toISOString();
        await db
          .insert(schema.meta)
          .values({ key: "lastImportAt", value: importedAt })
          .onConflictDoUpdate({
            target: schema.meta.key,
            set: { value: importedAt },
          });
      }

      // Coverage bookkeeping: the stored dataset cumulatively covers from
      // the earliest window ever imported. An incremental (30-day) import
      // must never move this forward — it can only stay or extend backwards
      // (e.g. a bootstrap import whose window starts Jan 1).
      const metaRows = await db.select().from(schema.meta);
      const prevCoverage =
        metaRows.find((r) => r.key === "dataCoverageStart")?.value ?? null;
      const earliestPayloadPosting = args.postings.reduce<string | null>((min, p) => {
        const eff = p.transactionDate ?? p.date;
        return min == null || eff < min ? eff : min;
      }, null);
      // Coverage is certified ONLY by a completed fetch: from its
      // windowStart (or, for a completed window-less import, its earliest
      // posting). A windowed import that did not complete certifies
      // NOTHING — not even its earliest delivered posting — so a truncated
      // bootstrap can never masquerade as year coverage; the stored
      // coverage marker stays untouched and a later refresh retries the
      // bootstrap / gap-fill window. Window-less imports (legacy/manual,
      // no window claimed) keep certifying from their earliest posting.
      const thisCoverage =
        args.complete === true
          ? (args.windowStart ?? earliestPayloadPosting)
          : args.windowStart == null
            ? earliestPayloadPosting
            : null;
      const dataCoverageStart =
        prevCoverage == null
          ? thisCoverage
          : thisCoverage == null || prevCoverage <= thisCoverage
            ? prevCoverage
            : thisCoverage;
      if (dataCoverageStart != null && dataCoverageStart !== prevCoverage) {
        await db
          .insert(schema.meta)
          .values({ key: "dataCoverageStart", value: dataCoverageStart })
          .onConflictDoUpdate({
            target: schema.meta.key,
            set: { value: dataCoverageStart },
          });
      }
      if (args.complete === true && args.windowStart) {
        await db
          .insert(schema.meta)
          .values({ key: "lastRefreshWindowStart", value: args.windowStart })
          .onConflictDoUpdate({
            target: schema.meta.key,
            set: { value: args.windowStart },
          });
      }
      if (args.complete === true && args.windowEnd) {
        await db
          .insert(schema.meta)
          .values({ key: "lastRefreshWindowEnd", value: args.windowEnd })
          .onConflictDoUpdate({
            target: schema.meta.key,
            set: { value: args.windowEnd },
          });
      }
      ctx.invalidateQueries();
      return {
        accountsAdded,
        postingsAdded,
        postingsSkipped,
        postingsCorrected,
        existingPostingsPreserved: existingPostingsCount,
        dataCoverageStart,
      };
    },
  }),

  refreshCredits: defineAction({
    request: z.object({}),
    response: z.object({
      started: z.boolean(),
      taskId: z.string().nullable(),
      error: z.string().nullable(),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const today = todayLA();
      const yearStart = `${today.slice(0, 4)}-01-01`;
      // Daily refresh window: fetch ONLY the trailing 30
      // days from Plaid/MCP. The stored dataset must nonetheless keep
      // covering the year from Jan 1 — that holds because importSnapshot is
      // merge-only (it inserts new postings and never deletes stored ones),
      // so older postings outside this window stay and keep counting.
      // Two exceptions widen the window so coverage from Jan 1 is real:
      //  - bootstrap: nothing stored yet (or no recorded coverage back to
      //    Jan 1) → fetch from Jan 1 once;
      //  - gap fill: the last successful import is older than the 30-day
      //    window (refreshes were missed) → fetch from just before that
      //    import, so no days are skipped; duplicates are deduped on import.
      const thirtyDayStart = addDays(today, -29);
      const [metaRows, accountRows, postingRows] = await Promise.all([
        db.select().from(schema.meta),
        db.select({ id: schema.accounts.id }).from(schema.accounts),
        db.select({ id: schema.postings.id }).from(schema.postings),
      ]);
      const lastImportAt = metaRows.find((r) => r.key === "lastImportAt")?.value ?? null;
      const coverageStart = metaRows.find((r) => r.key === "dataCoverageStart")?.value ?? null;
      const lastImportDate = lastImportAt ? laDateOf(lastImportAt) : null;
      const needsBootstrap =
        accountRows.length === 0 ||
        postingRows.length === 0 ||
        lastImportDate == null ||
        coverageStart == null ||
        coverageStart > yearStart;
      let windowStart: string;
      let mode: string;
      let windowReason: string;
      if (needsBootstrap) {
        windowStart = yearStart;
        mode = "bootstrap-full-year";
        windowReason = `no stored coverage back to ${yearStart} yet, so this run bootstraps the full year`;
      } else if (lastImportDate != null && lastImportDate < thirtyDayStart) {
        const backfillStart = addDays(lastImportDate, -2);
        windowStart = backfillStart < yearStart ? yearStart : backfillStart;
        mode = "gap-fill";
        windowReason = `the last successful import was ${lastImportDate}, older than the 30-day window, so this run backfills from just before it to leave no gap`;
      } else {
        windowStart = thirtyDayStart;
        mode = "incremental-30d";
        windowReason = "the regular daily window: the trailing 30 days only";
      }
      const message = [
        "Refresh the Amex Credits Dashboard data from Plaid.",
        "",
        "Steps:",
        "1. Run `/opt/hatch/bin/plaid accounts` and collect every account: plaidAccountId = account_id, name, mask, balance = balances.current, creditLimit = balances.limit. The output groups accounts by login under `institutions`: each institution entry is one Amex master account (one login). Set owner = \"A\" for every account in the first institution grouping and owner = \"B\" for every account in the second institution grouping (if there is only one, use \"A\" for all of them). Include owner on every account you pass.",
        `2. Run \`/opt/hatch/bin/plaid transactions-get --start-date ${windowStart} --end-date ${today}\` (dates are America/Los_Angeles calendar dates). Fetch ONLY this window — ${windowReason}. Do not widen it. Keep only statement-credit postings: amount < 0, not pending, and the transaction name contains 'credit' (case-insensitive) or is exactly 'Hilton'. For each kept transaction produce: txnId = transaction_id, accountPlaidId = account_id, date = the transaction's posted date (its \`date\` field), transactionDate = its authorized_date — pass authorized_date as transactionDate for EVERY posting (when Plaid gives no authorized_date, set transactionDate to the posted date). Credits count toward the period of the TRANSACTION date, not the posting date; the posted date is kept for display only. name, amount = the absolute value of amount (positive dollars of credit received).`,
        `3. Call this artifact's \`importSnapshot\` action with { accounts, postings, windowStart: "${windowStart}", windowEnd: "${today}", complete } exactly in that shape. Set complete to true ONLY if the Plaid accounts and transactions reads both succeeded for the entire window; if any read failed, was cut off, or returned partial data, set complete to false — the import then still merges what you read but does NOT certify the window as covered, so the next refresh retries this window instead of assuming the year is covered. The import is MERGE-ONLY: it inserts postings whose transaction id is new and never deletes, clears, or replaces stored data, so postings from earlier in the year (back to ${yearStart}) that fall outside this fetched window are preserved and keep counting — do not try to re-send or 'restore' them, and never pass an empty snapshot to reset anything. (One exception: if a re-fetched posting's authorized_date differs from what was stored, the import corrects its transactionDate in place — that is expected; always send both dates exactly as Plaid reports them.) Call importSnapshot even if the window contains zero new postings (accounts plus an empty postings array, complete: true when the empty result is a successful read), so the refresh is recorded. Do not invent, rename, or round any values; copy names and amounts from the Plaid output verbatim. If Plaid reports not connected or a read fails, still call importSnapshot with whatever complete data you could read and complete: false, and say what was missing in your final message.`,
      ].join("\n");
      const res = await ctx.agent.spawnTask(message, {
        expectsAction: "importSnapshot",
        dedupeKey: "plaid-amex-refresh",
      });
      if (!res.ok) {
        return { started: false, taskId: null, error: res.error };
      }
      await db
        .insert(schema.meta)
        .values({ key: "refreshTaskId", value: res.taskId })
        .onConflictDoUpdate({ target: schema.meta.key, set: { value: res.taskId } });
      await db
        .insert(schema.meta)
        .values({ key: "lastRefreshMode", value: mode })
        .onConflictDoUpdate({ target: schema.meta.key, set: { value: mode } });
      await db
        .insert(schema.meta)
        .values({ key: "lastRefreshWindowStart", value: windowStart })
        .onConflictDoUpdate({ target: schema.meta.key, set: { value: windowStart } });
      await db
        .insert(schema.meta)
        .values({ key: "lastRefreshWindowEnd", value: today })
        .onConflictDoUpdate({ target: schema.meta.key, set: { value: today } });
      return { started: true, taskId: res.taskId, error: null };
    },
  }),

  refreshStatus: defineAction({
    request: z.object({}),
    response: z.object({
      status: z.enum(["none", "queued", "running", "completed", "failed", "not_found"]),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.meta)
        .where(eq(schema.meta.key, "refreshTaskId"));
      const taskId = rows[0]?.value;
      if (!taskId) return { status: "none" as const };
      const s = await ctx.agent.status(taskId);
      return { status: s.status };
    },
  }),

  // Display labels for the two Amex logins (owner keys "A" / "B"). Stored in
  // the meta table; getDashboard falls back to "Login 1" / "Login 2" when a
  // label has never been set.
  setOwnerLabels: defineAction({
    request: z.object({
      aLabel: z.string().trim().min(1).max(40).optional(),
      bLabel: z.string().trim().min(1).max(40).optional(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const writes: [string, string][] = [];
      if (args.aLabel !== undefined) writes.push(["ownerALabel", args.aLabel]);
      if (args.bLabel !== undefined) writes.push(["ownerBLabel", args.bLabel]);
      for (const [key, value] of writes) {
        await db
          .insert(schema.meta)
          .values({ key, value })
          .onConflictDoUpdate({ target: schema.meta.key, set: { value } });
      }
      if (writes.length > 0) ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  // Display-exclusion preference: which credits the dashboard hides.
  // Stored in meta as JSON under `excludedCredits`; when it has never been
  // set, the built-in DEFAULT_EXCLUDED_PATTERNS applies, and once the user
  // stores a selection it is authoritative (an empty list shows
  // everything). Two writers, one storage path: the dashboard's Display
  // settings section (a toggle per hideable family) and the user's
  // assistant in chat both read / rewrite the preference through these
  // two actions. Hidden credits stay out of the dashboard list and every
  // total, and are named in the Agent Markdown so an assistant knows they
  // exist.
  getPreferences: defineAction({
    request: z.object({}),
    response: z.object({
      /** The effective exclusion list in force (stored, or the defaults). */
      excludedCredits: z.array(z.string()),
      /**
       * Every hideable family with its label and whether the effective
       * list currently hides it — the read the Display settings toggles
       * render from. `hidden` uses the same substring matching as the
       * dashboard filter, so a family stored under its full credit name
       * (not the short pattern) still reports hidden.
       */
      hideableFamilies: z.array(
        z.object({
          pattern: z.string(),
          label: z.string(),
          hidden: z.boolean(),
        }),
      ),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.meta)
        .where(eq(schema.meta.key, EXCLUDED_CREDITS_META_KEY));
      const excludedCredits =
        parseExcludedPatterns(rows[0]?.value) ?? [...DEFAULT_EXCLUDED_PATTERNS];
      return {
        excludedCredits,
        hideableFamilies: HIDEABLE_FAMILIES.map((f) => ({
          ...f,
          hidden: isExcludedName(f.label, excludedCredits),
        })),
      };
    },
  }),

  setExcludedCredits: defineAction({
    request: z.object({
      /** The COMPLETE new exclusion list — it replaces the stored one. */
      excludedCredits: z.array(z.string().min(1).max(80)).max(50),
    }),
    response: z.object({ excludedCredits: z.array(z.string()) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const normalized: string[] = [];
      for (const raw of args.excludedCredits) {
        const p = raw.trim().toLowerCase();
        if (p !== "" && !normalized.includes(p)) normalized.push(p);
      }
      // Validate against every credit name the app knows: the built-in
      // catalogs, the hideable families behind the defaults, and the
      // credit rows actually stored (the user may have renamed or added
      // credits). Unknown names are rejected, so a typo cannot silently
      // hide the wrong credit — or fail to hide the intended one.
      const storedNames = (
        await db.select({ name: schema.credits.name }).from(schema.credits)
      ).map((r) => r.name);
      const knownNames = [
        ...ALL_CATALOG_CREDIT_NAMES,
        ...HIDEABLE_CREDIT_NAMES,
        ...storedNames,
      ];
      const unknown = normalized.filter(
        (p) => !isKnownExclusionEntry(p, knownNames),
      );
      if (unknown.length > 0) {
        throw new Error(
          `setExcludedCredits: unknown credit name(s): ${unknown.join(", ")} — ` +
            "each entry must match a credit from the catalog or the stored credits",
        );
      }
      const value = JSON.stringify(normalized);
      await db
        .insert(schema.meta)
        .values({ key: EXCLUDED_CREDITS_META_KEY, value })
        .onConflictDoUpdate({
          target: schema.meta.key,
          set: { value },
        });
      ctx.invalidateQueries();
      return { excludedCredits: normalized };
    },
  }),

  updateCredit: defineAction({
    request: z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      amount: z.number().nonnegative().optional(),
      period: periodEnum.optional(),
      /** Anniversary anchor for annual credits; pass null to clear back to calendar-year. */
      anchorMonth: z.number().int().min(1).max(12).nullable().optional(),
      anchorDay: z.number().int().min(1).max(31).nullable().optional(),
      enrolled: z.boolean().optional(),
      active: z.boolean().optional(),
      note: z.string().optional(),
      matchPattern: z.string().optional(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const patch: Partial<typeof schema.credits.$inferInsert> = {};
      if (args.name !== undefined) patch.name = args.name;
      if (args.amount !== undefined) patch.amount = args.amount;
      if (args.period !== undefined) patch.period = args.period;
      if (args.anchorMonth !== undefined) patch.anchorMonth = args.anchorMonth;
      if (args.anchorDay !== undefined) patch.anchorDay = args.anchorDay;
      if (args.enrolled !== undefined) patch.enrolled = args.enrolled ? 1 : 0;
      if (args.active !== undefined) patch.active = args.active ? 1 : 0;
      if (args.note !== undefined) patch.note = args.note;
      if (args.matchPattern !== undefined) patch.matchPattern = args.matchPattern;
      if (Object.keys(patch).length > 0) {
        await db.update(schema.credits).set(patch).where(eq(schema.credits.id, args.id));
        ctx.invalidateQueries();
      }
      return { ok: true as const };
    },
  }),

  addCredit: defineAction({
    request: z.object({
      accountId: z.number(),
      name: z.string().min(1),
      amount: z.number().positive(),
      period: periodEnum,
      anchorMonth: z.number().int().min(1).max(12).optional(),
      anchorDay: z.number().int().min(1).max(31).optional(),
      note: z.string().default(""),
      matchPattern: z.string().default(""),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const inserted = await db
        .insert(schema.credits)
        .values({
          accountId: args.accountId,
          name: args.name,
          amount: args.amount,
          period: args.period,
          anchorMonth: args.anchorMonth ?? null,
          anchorDay: args.anchorDay ?? null,
          note: args.note,
          matchPattern: args.matchPattern,
          sortOrder: 100,
        })
        .returning({ id: schema.credits.id });
      const row = inserted[0];
      if (!row) throw new Error("addCredit: insert returned no rows");
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  deleteCredit: defineAction({
    request: z.object({ id: z.number() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.postings)
        .set({ creditId: null })
        .where(eq(schema.postings.creditId, args.id));
      await db.delete(schema.credits).where(eq(schema.credits.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  addManualPosting: defineAction({
    request: z.object({
      creditId: z.number(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      amount: z.number().positive(),
      note: z.string().default(""),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const creditRows = await db
        .select()
        .from(schema.credits)
        .where(eq(schema.credits.id, args.creditId));
      const credit = creditRows[0];
      if (!credit) throw new Error("addManualPosting: credit not found");
      const inserted = await db
        .insert(schema.postings)
        .values({
          txnId: null,
          accountId: credit.accountId,
          creditId: credit.id,
          date: args.date,
          name: args.note !== "" ? args.note : "Manual entry",
          amount: args.amount,
          source: "manual",
        })
        .returning({ id: schema.postings.id });
      const row = inserted[0];
      if (!row) throw new Error("addManualPosting: insert returned no rows");
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  deletePosting: defineAction({
    request: z.object({ id: z.number() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.postings).where(eq(schema.postings.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  assignPosting: defineAction({
    request: z.object({ postingId: z.number(), creditId: z.number().nullable() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.postings)
        .set({ creditId: args.creditId })
        .where(eq(schema.postings.id, args.postingId));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  setAccountIgnored: defineAction({
    request: z.object({ accountId: z.number(), ignored: z.boolean() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.accounts)
        .set({ ignored: args.ignored ? 1 : 0 })
        .where(eq(schema.accounts.id, args.accountId));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  listUnassignedCount: defineAction({
    request: z.object({}),
    response: z.object({ count: z.number() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select({ id: schema.postings.id })
        .from(schema.postings)
        .where(isNull(schema.postings.creditId));
      return { count: rows.length };
    },
  }),
} satisfies ActionsModule;
