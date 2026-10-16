// Drizzle schema for the Credit Card Coupon Book Dashboard.
//
// accounts  — one row per Plaid account record (supplementary-card
//             duplicates across the two logins are flagged `ignored` —
//             only ever by the user's own decision, never by a guess).
// credits   — the benefit catalog: one row per (account, credit) with its
//             calendar-period amount. All rows user-editable.
// postings  — actual statement-credit postings imported from Plaid, plus
//             manual rows the user adds (txnId null, source 'manual').
//             Amounts are SIGNED: positive = dollars of credit received,
//             negative = a reversal / clawback (the issuer took a credit
//             back). The store is merge-only and never deletes, so
//             corrections arrive as reversing entries that net against
//             the original posting.
// meta      — key/value store (last import time, refresh task id, the
//             display labels for the two logins: ownerALabel / ownerBLabel,
//             the display-exclusion preference, and the user's timezone).

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  plaidAccountId: text("plaid_account_id").notNull().unique(),
  name: text("name").notNull(),
  mask: text("mask").notNull().default(""),
  balance: real("balance"),
  creditLimit: real("credit_limit"),
  /** Card network issuer of this account: "Amex", "Chase" or "U.S. Bank". */
  issuer: text("issuer").notNull().default("Amex"),
  /**
   * User-chosen display prefix for this account (e.g. "UA"), shown before
   * the account's name everywhere the dashboard and the Agent Markdown
   * render it. Set only through the updateAccount action — a Plaid
   * re-import NEVER overwrites it (imports rewrite the Plaid `name`,
   * which is exactly why the stable user label lives in its own column).
   */
  nickname: text("nickname").notNull().default(""),
  /**
   * The digit immediately before the card's last four — the
   * fifth-from-last digit of the card number — recorded by the user to
   * tell apart one person's same-product cards that share a mask (a
   * household can hold three Aspires all ending 1003; the issuers' apps
   * show a five-digit ending, 41003 vs 81003, that distinguishes them).
   * "" until recorded. Like the nickname, it is set only through
   * updateAccount and imports never touch it.
   */
  fifthDigit: text("fifth_digit").notNull().default(""),
  /** ISO currency code from Plaid (balances.iso_currency_code); null → USD. */
  currency: text("currency"),
  /**
   * Which login (master account) this account record belongs to,
   * stored as a key: "A" for the first login, "B" for the second. The
   * display labels for the two keys live in the meta table (ownerALabel /
   * ownerBLabel) and default to "Login 1" / "Login 2". Null until
   * identified.
   */
  owner: text("owner"),
  /** 1 when this record duplicates another login's view of the same account. */
  ignored: integer("ignored").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const credits = sqliteTable("credits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id),
  name: text("name").notNull(),
  /** Dollars available per period. */
  amount: real("amount").notNull(),
  period: text("period", {
    enum: ["monthly", "quarterly", "semiannual", "annual"],
  }).notNull(),
  /**
   * Optional anniversary anchor for annual credits: when both are set, the
   * credit's year runs anchor-to-anchor (e.g. month 5, day 1 = May 1 of one
   * year through Apr 30 of the next) instead of the calendar year. Used by
   * cardmember-anniversary programs (Chase Sapphire Preferred, World of
   * Hyatt Business). Null for calendar-cycle credits.
   */
  anchorMonth: integer("anchor_month"),
  anchorDay: integer("anchor_day"),
  /**
   * 1 once a human has confirmed the anniversary anchor is the card's
   * real one. Anchors seeded from catalog defaults start at 0
   * (unconfirmed) and surface in the UI and the Agent Markdown warnings
   * until the user confirms or corrects them via updateCredit.
   */
  anchorConfirmed: integer("anchor_confirmed").notNull().default(0),
  /**
   * 1 when the user deleted this credit. Deletion is a tombstone, not a
   * hard delete: the row stays so compute-time synthesis (which fills in
   * every catalog credit that has no stored row) never resurrects it.
   */
  deleted: integer("deleted").notNull().default(0),
  /** Lowercase substring matched against Plaid posting names for auto-mapping. */
  matchPattern: text("match_pattern").notNull().default(""),
  /**
   * The user's asserted enrollment state (1 = enrolled, 0 = not enrolled).
   * Meaningful ONLY when enrolledAsserted is 1: the app cannot observe the
   * issuer's enrollment state, so an un-asserted row is UNKNOWN — it must
   * never be displayed or exported as "not enrolled".
   */
  enrolled: integer("enrolled").notNull().default(1),
  /** 1 once the user has explicitly marked this row enrolled or not enrolled. */
  enrolledAsserted: integer("enrolled_asserted").notNull().default(0),
  active: integer("active").notNull().default(1),
  note: text("note").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const postings = sqliteTable("postings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  txnId: text("txn_id").unique(),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id),
  creditId: integer("credit_id").references(() => credits.id),
  /** YYYY-MM-DD — the POSTED date (when the credit hit the statement). Display only. */
  date: text("date").notNull(),
  /**
   * YYYY-MM-DD — the TRANSACTION date (Plaid `authorized_date`): the date of
   * the underlying transaction the credit belongs to. Period bucketing uses
   * this date, never the posted date; a credit authorized Sep 30 but posted
   * Oct 2 counts in Q3. Null when Plaid gave no authorized date — bucketing
   * then falls back to the posted date.
   */
  transactionDate: text("transaction_date"),
  name: text("name").notNull(),
  /**
   * Signed dollars: positive = statement credit received, negative = a
   * reversal / clawback of an earlier credit. Usage sums signed amounts,
   * so a clawback reduces used and restores remaining.
   */
  amount: real("amount").notNull(),
  source: text("source", { enum: ["plaid", "manual"] })
    .notNull()
    .default("plaid"),
});

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * Import-time duplicate evidence: a row (accountId, otherAccountId)
 * means "a Plaid transaction id arrived under accountId but was already
 * stored under otherAccountId" — the two records saw the same
 * transaction, the signature of a primary account and its
 * supplementary-card view across logins. Evidence only: it feeds the
 * read-time `suspectedDuplicate` flag; nothing is ever auto-ignored.
 */
export const accountDuplicateEvidence = sqliteTable(
  "account_duplicate_evidence",
  {
    accountId: integer("account_id").notNull(),
    otherAccountId: integer("other_account_id").notNull(),
  },
);
