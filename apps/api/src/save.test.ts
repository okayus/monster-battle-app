import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { GameMap, Position, SaveData, TileKind } from "@mba/core";
import { maps, saves } from "@mba/db";

import { LOCAL_USER_ID } from "./auth.js";
import { START_MAP_ID, starterMap } from "./maps.js";
import { setup } from "./testing.js";
import type { TestApp } from "./testing.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function starter(): GameMap {
  const map = starterMap();
  if (!map.ok) throw new Error(`the starter map is invalid: ${JSON.stringify(map.error)}`);
  return map.value;
}

const MAP = starter();

/** The first tile of a kind on the starter map, as a position. */
function firstTile(kind: TileKind): Position {
  const i = MAP.tiles.indexOf(kind);
  if (i < 0) throw new Error(`the starter map has no ${kind}`);
  return { x: i % MAP.width, y: Math.floor(i / MAP.width) };
}

/** Somewhere a player can stand that is not where they start. */
const ON_GRASS = firstTile("grass");

function put(app: TestApp, body: unknown, headers: Record<string, string> = {}) {
  return app.request("/api/save", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** What GET /api/save answers right now. */
async function current(app: TestApp): Promise<SaveData> {
  const res = await app.request("/api/save");
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  return (await res.json()) as SaveData;
}

const AT_SPAWN: SaveData = { mapId: START_MAP_ID, position: MAP.spawn };

// ---------------------------------------------------------------------------

describe("GET /api/save", () => {
  it("starts a player with no save at the starter map's spawn, without writing anything", async () => {
    const { app, db } = setup();
    expect(await current(app)).toEqual(AT_SPAWN);
    expect(db.select().from(saves).all()).toEqual([]);
  });

  it("returns what was saved", async () => {
    const { app } = setup();
    await put(app, { mapId: START_MAP_ID, position: ON_GRASS });
    expect(await current(app)).toEqual({ mapId: START_MAP_ID, position: ON_GRASS });
  });

  it("falls back to the spawn when the map was redrawn and the saved tile is now blocked", async () => {
    const { app, db } = setup();
    await put(app, { mapId: START_MAP_ID, position: ON_GRASS });

    // What an edit from the admin screen would do: a tree where the player stood.
    const tiles = [...MAP.tiles];
    tiles[ON_GRASS.y * MAP.width + ON_GRASS.x] = "tree";
    db.update(maps)
      .set({ tiles: JSON.stringify(tiles) })
      .where(eq(maps.id, START_MAP_ID))
      .run();

    expect(await current(app)).toEqual(AT_SPAWN);
  });
});

describe("PUT /api/save", () => {
  it("stores a position a player can stand on, and echoes it back", async () => {
    const { app, db } = setup();
    const save = { mapId: START_MAP_ID, position: ON_GRASS };

    const res = await put(app, save);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(save);

    const rows = db.select().from(saves).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mapId: START_MAP_ID, x: ON_GRASS.x, y: ON_GRASS.y });
  });

  it("keeps one row per player: saving again replaces the position", async () => {
    const { app, db } = setup();
    await put(app, { mapId: START_MAP_ID, position: ON_GRASS });
    await put(app, AT_SPAWN);

    expect(db.select().from(saves).all()).toHaveLength(1);
    expect(await current(app)).toEqual(AT_SPAWN);
  });

  it("decides whose save it is on the server, whatever the body claims", async () => {
    const { app, db } = setup();
    const res = await put(app, { ...AT_SPAWN, userId: "someone-else", user_id: "someone-else" });
    expect(res.status).toBe(200);
    expect(db.select().from(saves).get()?.userId).toBe(LOCAL_USER_ID);
  });

  describe("rejects with 400, and leaves the save as it was", () => {
    const offMap = { x: MAP.width, y: 0 };

    it.each([
      ["a tree", firstTile("tree")],
      ["water", firstTile("water")],
      ["a position past the right edge", offMap],
      ["a negative position", { x: -1, y: 0 }],
    ])("standing on %s", async (_label, position) => {
      const { app } = setup();
      await put(app, { mapId: START_MAP_ID, position: ON_GRASS });

      const res = await put(app, { mapId: START_MAP_ID, position });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { kind: "cannot_stand", mapId: START_MAP_ID, position },
      });
      expect(await current(app)).toEqual({ mapId: START_MAP_ID, position: ON_GRASS });
    });

    it("a map that does not exist", async () => {
      const { app, db } = setup();
      const res = await put(app, { mapId: "no-such-map", position: { x: 1, y: 1 } });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { kind: "unknown_map", mapId: "no-such-map" } });
      expect(db.select().from(saves).all()).toEqual([]);
    });

    it.each([
      ["no position", { mapId: START_MAP_ID }, "$.position"],
      ["no map id", { position: ON_GRASS }, "$.mapId"],
      [
        "a coordinate that is a string",
        { mapId: START_MAP_ID, position: { x: "1", y: 1 } },
        "$.position.x",
      ],
      [
        "a coordinate between tiles",
        { mapId: START_MAP_ID, position: { x: 1, y: 1.5 } },
        "$.position.y",
      ],
      ["a body that is not an object", null, "$"],
    ])("%s", async (_label, body, at) => {
      const { app, db } = setup();
      const res = await put(app, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { kind: "malformed", at } });
      expect(db.select().from(saves).all()).toEqual([]);
    });

    it("a body that is not JSON", async () => {
      const { app } = setup();
      const res = await put(app, "{ not json");
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { kind: "bad_json" } });
    });
  });

  it("answers 413 for a body far larger than any save", async () => {
    const { app, db } = setup();
    const res = await put(app, { ...AT_SPAWN, junk: "x".repeat(2000) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: { kind: "body_too_large", max: 1024 } });
    expect(db.select().from(saves).all()).toEqual([]);
  });
});
