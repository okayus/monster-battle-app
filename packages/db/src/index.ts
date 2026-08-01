/**
 * SQLite client and migration runner.
 *
 * Migrations are the plain `.sql` files drizzle-kit writes into `drizzle/`;
 * they are applied at boot by `runMigrations()`, so a fresh `pnpm dev` after
 * `pnpm install` just works and no separate migrate step is needed.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema.js";

export * from "./schema.js";

export type Db = ReturnType<typeof createDb>;

/** `file:./data/app.db` and `./data/app.db` are both accepted. */
function toFilePath(databaseUrl: string): string {
  return databaseUrl.startsWith("file:") ? databaseUrl.slice("file:".length) : databaseUrl;
}

export function createDb(databaseUrl: string) {
  const sqlite = new Database(toFilePath(databaseUrl));
  // Write-ahead logging: readers don't block the writer. Sensible default for a
  // server process that reads far more often than it writes.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

/**
 * Applies every `.sql` file in `drizzle/` in filename order, once each.
 * Deliberately tiny and dependency-free: no drizzle-kit at runtime.
 */
export function runMigrations(db: Db): { applied: number } {
  const raw = db.$client;
  raw.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");

  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    return { applied: 0 }; // no migrations generated yet
  }

  const done = new Set(
    (raw.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name),
  );

  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    raw.exec("BEGIN");
    try {
      raw.exec(sql);
      raw.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(file, Date.now());
      raw.exec("COMMIT");
      applied++;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  }
  return { applied };
}
