ALTER TABLE accounts ADD COLUMN issuer TEXT NOT NULL DEFAULT 'Amex';
--> statement-breakpoint
ALTER TABLE credits ADD COLUMN anchor_month INTEGER;
--> statement-breakpoint
ALTER TABLE credits ADD COLUMN anchor_day INTEGER;
--> statement-breakpoint
ALTER TABLE postings ADD COLUMN transaction_date TEXT;
