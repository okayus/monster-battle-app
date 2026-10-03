import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { MapInput, SaveData } from "@mba/core";
import { maps, saves } from "@mba/db";

import { LOCAL_USER_ID } from "./auth.js";
import { START_MAP_ID } from "./maps.js";
import { createMap, firstTile, setup, starter, visit } from "./testing.js";
import type { TestApp } from "./testing.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAP = starter();

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

// ---------------------------------------------------------------------------
// Where a player may be, now that being somewhere is worth something
//
// A battle won leaves the monster with experience, and battles are fought on
// the grass the server has the player standing on. So a save is taken only if
// the player could have walked there (docs/04-api-design.md §実装).
// ---------------------------------------------------------------------------

/**
 * Two rooms, and a wall of trees with no gap between them:
 *
 *        01234
 *      0 .T..g      the left room: (0,0), and the spawn at (0,1)
 *      1 @T...      the right room: everything past the trees; grass at (4,0)
 */
const ROOMS: MapInput = {
  name: "ふたつの部屋",
  width: 5,
  height: 2,
  tiles: ["path", "tree", "path", "path", "grass", "path", "tree", "path", "path", "path"],
  spawn: { x: 0, y: 1 },
  encounters: [{ speciesId: "moss", weight: 1 }],
  exits: [],
};
const IN_THE_LEFT_ROOM = { x: 0, y: 1 };
const IN_THE_RIGHT_ROOM = { x: 2, y: 1 };
const GRASS_ON_THE_RIGHT = { x: 4, y: 0 };

describe("PUT /api/save, asked for a tile the player would have had to walk to", () => {
  it("refuses a tile on the far side of a wall, and leaves the save as it was", async () => {
    const { app } = setup();
    const id = await createMap(app, ROOMS);
    await visit(app, id, IN_THE_LEFT_ROOM);

    const res = await put(app, { mapId: id, position: GRASS_ON_THE_RIGHT });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { kind: "unreachable", mapId: id, position: GRASS_ON_THE_RIGHT },
    });
    expect(await current(app)).toEqual({ mapId: id, position: IN_THE_LEFT_ROOM });
  });

  it("so a battle cannot be started on grass the player could not have reached", async () => {
    const { app } = setup();
    const id = await createMap(app, ROOMS);
    await visit(app, id, IN_THE_LEFT_ROOM);
    await put(app, { mapId: id, position: GRASS_ON_THE_RIGHT });

    const res = await app.request("/api/battles", { method: "POST" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { kind: "no_encounters_here" } });
  });

  it("takes the very same tile from a player who came in on that side of the wall", async () => {
    const { app } = setup();
    const id = await createMap(app, ROOMS);
    await visit(app, id, IN_THE_RIGHT_ROOM);

    const res = await put(app, { mapId: id, position: GRASS_ON_THE_RIGHT });
    expect(res.status).toBe(200);
    expect(await current(app)).toEqual({ mapId: id, position: GRASS_ON_THE_RIGHT });
    expect((await app.request("/api/battles", { method: "POST" })).status).toBe(201);
  });

  it("measures the walk from where the server has the player, whatever the request says", async () => {
    const { app } = setup();
    const id = await createMap(app, ROOMS);
    await visit(app, id, IN_THE_LEFT_ROOM);

    const res = await put(app, {
      mapId: id,
      position: GRASS_ON_THE_RIGHT,
      from: IN_THE_RIGHT_ROOM,
      current: { mapId: id, position: IN_THE_RIGHT_ROOM },
    });
    expect(res.status).toBe(400);
    expect(await current(app)).toEqual({ mapId: id, position: IN_THE_LEFT_ROOM });
  });

  it("measures it from the last save that was taken, and a refused one is not that", async () => {
    const { app } = setup();
    const id = await createMap(app, ROOMS);
    await visit(app, id, IN_THE_LEFT_ROOM);

    // A step inside the left room is taken; the walk goes on from there.
    expect((await put(app, { mapId: id, position: { x: 0, y: 0 } })).status).toBe(200);
    // Asking twice does not turn the first, refused, answer into a way through.
    expect((await put(app, { mapId: id, position: IN_THE_RIGHT_ROOM })).status).toBe(400);
    expect((await put(app, { mapId: id, position: GRASS_ON_THE_RIGHT })).status).toBe(400);
    expect(await current(app)).toEqual({ mapId: id, position: { x: 0, y: 0 } });
  });

  it("measures it from the spawn for a player who never saved", async () => {
    const { app, db } = setup();
    // Trees on both ways out of the spawn at (1,1): a new game is walled in.
    const tiles = [...MAP.tiles];
    tiles[1 * MAP.width + 2] = "tree";
    tiles[2 * MAP.width + 1] = "tree";
    db.update(maps)
      .set({ tiles: JSON.stringify(tiles) })
      .where(eq(maps.id, START_MAP_ID))
      .run();

    const res = await put(app, { mapId: START_MAP_ID, position: ON_GRASS });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { kind: "unreachable", mapId: START_MAP_ID, position: ON_GRASS },
    });
    expect(db.select().from(saves).all()).toEqual([]);
  });

  it("does not ask how long the walk is: the far corner of the map, in one save", async () => {
    const { app } = setup();
    const farCorner = { x: 14, y: 10 };
    expect((await put(app, { mapId: START_MAP_ID, position: farCorner })).status).toBe(200);
    expect(await current(app)).toEqual({ mapId: START_MAP_ID, position: farCorner });
  });

  it("says a tile cannot be stood on before it says it cannot be reached", async () => {
    const { app } = setup();
    const id = await createMap(app, ROOMS);
    await visit(app, id, IN_THE_LEFT_ROOM);

    // The wall itself: nobody can stand there, from either side.
    const res = await put(app, { mapId: id, position: { x: 1, y: 0 } });
    expect(await res.json()).toEqual({
      error: { kind: "cannot_stand", mapId: id, position: { x: 1, y: 0 } },
    });
  });
});
