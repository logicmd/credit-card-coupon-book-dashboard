DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plaid_account_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mask TEXT NOT NULL DEFAULT '',
  balance REAL,
  credit_limit REAL,
  ignored INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  period TEXT NOT NULL,
  match_pattern TEXT NOT NULL DEFAULT '',
  enrolled INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE postings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_id TEXT UNIQUE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  credit_id INTEGER REFERENCES credits(id),
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'plaid'
);
--> statement-breakpoint
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX postings_account_idx ON postings(account_id);
--> statement-breakpoint
CREATE INDEX postings_credit_idx ON postings(credit_id);
--> statement-breakpoint
CREATE INDEX credits_account_idx ON credits(account_id);
