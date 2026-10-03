import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { canStandOn, step } from "@mba/core";
import type { Direction, Position } from "@mba/core";
import { maps } from "@mba/db";

import { START_MAP_ID, ensureStarterMap, mapFromArt } from "./maps.js";
import { setup, starter } from "./testing.js";

describe("the starter map", () => {
  it("is a complete grid", () => {
    const map = starter();
    expect(map.width).toBeGreaterThan(0);
    expect(map.height).toBeGreaterThan(0);
    expect(map.tiles).toHaveLength(map.width * map.height);
  });

  it("starts the player somewhere they can stand", () => {
    const map = starter();
    expect(canStandOn(map, map.spawn)).toBe(true);
  });

  it("has no walkable tile that cannot be reached from the spawn", () => {
    const map = starter();
    const key = (at: Position) => `${at.x},${at.y}`;
    const directions: Direction[] = ["up", "down", "left", "right"];

    // Flood fill, using the same `step` a player moves with.
    const reached = new Set([key(map.spawn)]);
    const frontier = [map.spawn];
    for (let at = frontier.pop(); at !== undefined; at = frontier.pop()) {
      for (const dir of directions) {
        const next = step(at, dir, map);
        if (reached.has(key(next))) continue;
        reached.add(key(next));
        frontier.push(next);
      }
    }

    const walkable = map.tiles.filter((_, i) =>
      canStandOn(map, { x: i % map.width, y: Math.floor(i / map.width) }),
    );
    expect(reached.size).toBe(walkable.length);
  });
});

describe("mapFromArt", () => {
  it("reads rows top to bottom, and puts the spawn on a path tile", () => {
    expect(mapFromArt("m", "test", ["g@", "Tw"])).toEqual({
      ok: true,
      value: {
        id: "m",
        name: "test",
        width: 2,
        height: 2,
        tiles: ["grass", "path", "tree", "water"],
        spawn: { x: 1, y: 0 },
      },
    });
  });

  it.each([
    ["rows of different lengths", ["@..", ".."], { kind: "ragged_row", row: 1 }],
    ["a character with no meaning", ["@x"], { kind: "unknown_tile", row: 0, char: "x" }],
    ["no spawn", [".."], { kind: "spawn_count", got: 0 }],
    ["two spawns", ["@@"], { kind: "spawn_count", got: 2 }],
  ])("rejects %s", (_label, rows, error) => {
    expect(mapFromArt("m", "test", rows)).toEqual({ ok: false, error });
  });
});

describe("ensureStarterMap", () => {
  it("seeds the map once, however many times it runs", () => {
    const { db } = setup();
    expect(ensureStarterMap(db).ok).toBe(true);
    expect(ensureStarterMap(db).ok).toBe(true);
    expect(db.select().from(maps).all()).toHaveLength(1);
  });

  it("does not overwrite a map that was edited after it was seeded", () => {
    const { db } = setup();
    db.update(maps).set({ name: "edited" }).where(eq(maps.id, START_MAP_ID)).run();

    expect(ensureStarterMap(db).ok).toBe(true);
    expect(db.select().from(maps).get()?.name).toBe("edited");
  });
});

describe("GET /api/maps/:id", () => {
  it("returns the map in the shape the game logic uses", async () => {
    const { app } = setup();
    const res = await app.request(`/api/maps/${START_MAP_ID}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(starter());
  });

  it("answers 404 for a map that does not exist", async () => {
    const { app } = setup();
    const res = await app.request("/api/maps/no-such-map");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { kind: "not_found" } });
  });
});
