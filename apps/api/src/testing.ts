/**
 * Shared by the test files. Not a test itself — there is no `.test.` in the
 * name, so vitest does not try to run it, and nothing in `index.ts` imports
 * it, so it is not part of the build.
 */

import type { GameMap, Position, TileKind } from "@mba/core";
import { createDb, runMigrations } from "@mba/db";

import { createApp } from "./app.js";
import { starterMap } from "./maps.js";
import { seed } from "./seed.js";

/**
 * A fresh in-memory database per test, brought up the way a real boot does it:
 * the committed migration files, then the same seeding `index.ts` runs. The
 * SQL and the seed are therefore under test as well.
 *
 * `random` stands in for the server's random numbers. It is fixed by default,
 * so a test that does not care about them still gets the same result every run.
 */
export function setup(options: { random?: () => number } = {}) {
  const db = createDb(":memory:");
  const { applied } = runMigrations(db);
  const seeded = seed(db);
  if (!seeded.ok) throw new Error(`the seed data is invalid: ${JSON.stringify(seeded.error)}`);
  const random = options.random ?? (() => 0.5);
  return { db, applied, app: createApp({ db, migrationsApplied: applied, random }) };
}

export type TestApp = ReturnType<typeof setup>["app"];

/** The starter map, as the seed draws it. */
export function starter(): GameMap {
  const map = starterMap();
  if (!map.ok) throw new Error(`the starter map is invalid: ${JSON.stringify(map.error)}`);
  return map.value;
}

/** The first tile of a kind on the starter map, as a position. */
export function firstTile(kind: TileKind): Position {
  const map = starter();
  const i = map.tiles.indexOf(kind);
  if (i < 0) throw new Error(`the starter map has no ${kind}`);
  return { x: i % map.width, y: Math.floor(i / map.width) };
}

/** Rolls handed out in order; once they run out, the last one repeats. */
export function rolls(...values: number[]): () => number {
  let next = 0;
  return () => values[Math.min(next++, values.length - 1)] ?? 0;
}
