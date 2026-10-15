// Drizzle schema for the Amex Credits Dashboard.
//
// accounts  — one row per Plaid Amex account record (supplementary-card
//             duplicates across the two logins are flagged `ignored`).
// credits   — the benefit catalog: one row per (account, credit) with its
//             calendar-period amount. All rows user-editable.
// postings  — actual Amex statement-credit postings imported from Plaid
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
  /**
   * Which Amex login (master account) this account record belongs to,
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
  /** YYYY-MM-DD (America/Los_Angeles calendar date of the posting). */
  date: text("date").notNull(),
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
