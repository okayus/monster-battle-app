/**
 * Shared by the test files. Not a test itself — there is no `.test.` in the
 * name, so vitest does not try to run it, and nothing in `index.ts` imports
 * it, so it is not part of the build.
 */

import { createDb, runMigrations } from "@mba/db";

import { createApp } from "./app.js";
import { ensureLocalUser } from "./auth.js";
import { ensureStarterMap } from "./maps.js";

/**
 * A fresh in-memory database per test, brought up the way a real boot does it:
 * the committed migration files, then the same seeding `index.ts` runs. The
 * SQL and the seed are therefore under test as well.
 */
export function setup() {
  const db = createDb(":memory:");
  const { applied } = runMigrations(db);
  ensureLocalUser(db);
  const seeded = ensureStarterMap(db);
  if (!seeded.ok) throw new Error(`the starter map is invalid: ${JSON.stringify(seeded.error)}`);
  return { db, applied, app: createApp({ db, migrationsApplied: applied }) };
}

export type TestApp = ReturnType<typeof setup>["app"];
