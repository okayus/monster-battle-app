/**
 * Shared by the test files. Not a test itself — there is no `.test.` in the
 * name, so vitest does not try to run it, and nothing in `index.ts` imports
 * it, so it is not part of the build.
 */

import type { AdminMap, GameMap, MapExit, MapInput, Position, TileKind } from "@mba/core";
import { createDb, runMigrations } from "@mba/db";

import { createApp } from "./app.js";
import { START_MAP_ID, starterMap } from "./maps.js";
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

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** Makes a map the way the admin screen would, and returns its id. */
export async function createMap(app: TestApp, input: MapInput): Promise<string> {
  const res = await app.request("/api/admin/maps", json("POST", input));
  if (res.status !== 201) throw new Error(`creating a map: ${await res.text()}`);
  return ((await res.json()) as AdminMap).id;
}

/** Replaces the starter map's exits and leaves the rest of it as it is. */
export async function setStarterExits(app: TestApp, exits: MapExit[]): Promise<void> {
  const all = (await (await app.request("/api/admin/maps")).json()) as AdminMap[];
  const start = all.find((map) => map.id === START_MAP_ID);
  if (start === undefined) throw new Error("there is no starter map");
  const { id: _id, retired: _retired, ...input } = start;
  const res = await app.request(
    `/api/admin/maps/${START_MAP_ID}`,
    json("PUT", { ...input, exits }),
  );
  if (res.status !== 200) throw new Error(`editing the starter map: ${await res.text()}`);
}

/**
 * Takes the player to a position on another map — the only way there is: an
 * exit on the starter map that leads there, a save onto that exit, and a trip
 * through it. The exit is taken away again afterwards, so the starter map is
 * left as it was and nothing refers to the other map.
 */
export async function visit(app: TestApp, mapId: string, position: Position): Promise<void> {
  const door = starter().spawn;
  await setStarterExits(app, [{ at: door, to: { mapId, position } }]);

  const stood = await app.request(
    "/api/save",
    json("PUT", { mapId: START_MAP_ID, position: door }),
  );
  if (stood.status !== 200) throw new Error(`standing on the exit: ${await stood.text()}`);
  const travelled = await app.request("/api/travel", { method: "POST" });
  if (travelled.status !== 200) throw new Error(`going through: ${await travelled.text()}`);

  await setStarterExits(app, []);
}
