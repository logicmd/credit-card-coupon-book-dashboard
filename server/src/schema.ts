// Drizzle schema for the Credit Card Coupon Book Dashboard.
//
// accounts  — one row per Plaid account record (supplementary-card
//             duplicates across the two logins are flagged `ignored`).
// credits   — the benefit catalog: one row per (account, credit) with its
//             calendar-period amount. All rows user-editable.
// postings  — actual statement-credit postings imported from Plaid
//             (amount is positive = dollars of credit received), plus
//             manual rows the user adds (txnId null, source 'manual').
// meta      — key/value store (last import time, refresh task id, and the
//             display labels for the two logins: ownerALabel / ownerBLabel).

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  plaidAccountId: text("plaid_account_id").notNull().unique(),
  name: text("name").notNull(),
  mask: text("mask").notNull().default(""),
  balance: real("balance"),
  creditLimit: real("credit_limit"),
  /** Card network issuer of this account: "Amex" or "Chase". */
  issuer: text("issuer").notNull().default("Amex"),
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
  /** Lowercase substring matched against Plaid posting names for auto-mapping. */
  matchPattern: text("match_pattern").notNull().default(""),
  enrolled: integer("enrolled").notNull().default(1),
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
  /** Positive dollars of statement credit received. */
  amount: real("amount").notNull(),
  source: text("source", { enum: ["plaid", "manual"] })
    .notNull()
    .default("plaid"),
});

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
