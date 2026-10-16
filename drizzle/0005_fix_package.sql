ALTER TABLE accounts ADD COLUMN nickname TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN currency TEXT;
--> statement-breakpoint
ALTER TABLE credits ADD COLUMN anchor_confirmed INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE credits ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
