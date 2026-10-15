// Shared test setup: an in-memory SQLite database with the real Drizzle
// migrations applied, plus a minimal fake action ctx whose `db` accessor
// returns it. The action handlers are plain functions, so tests can call
// `Actions.<name>.handler(ctx, args)` directly — no server, no network.

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as schema from "../server/src/schema";

export function createTestDb() {
  const sqlite = new Database(":memory:");
  const migrationsDir = join(import.meta.dir, "..", "drizzle");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      if (stmt.trim()) sqlite.exec(stmt);
    }
  }
  return drizzle(sqlite, { schema });
}

export type TestDb = ReturnType<typeof createTestDb>;

/** Minimal ctx stand-in: only `db` and `invalidateQueries` are used by the actions under test. */
export function fakeCtx(db: TestDb) {
  return {
    db: () => db,
    invalidateQueries: () => {},
    agent: {
      spawnTask: async () => ({ ok: false, error: "agent not available in tests" }),
      status: async () => ({ status: "none" }),
    },
  } as any;
}

/** Today's America/Los_Angeles calendar date (YYYY-MM-DD), same definition the server uses. */
export function todayLA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
