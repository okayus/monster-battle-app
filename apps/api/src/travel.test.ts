import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type {
  AdminMap,
  BattleView,
  GameMap,
  MapExit,
  MapInput,
  Position,
  SaveData,
} from "@mba/core";
import { mapExits, maps, saves } from "@mba/db";

import { START_MAP_ID } from "./maps.js";
import { rolls, setStarterExits, setup, starter } from "./testing.js";
import type { TestApp } from "./testing.js";

// ---------------------------------------------------------------------------
// Helpers
//
// The starter map, for reading the coordinates below (x across, y down):
//
//        0123456789012345
//      0 TTTTTTTTTTTTTTTT      T tree   w water
//      1 T@...gggg..wwwwT      . path   g grass
//      2 T.TT.gggg..wwwwT      @ where a new game starts: (1,1)
// ---------------------------------------------------------------------------

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function admin(app: TestApp, method: string, path: string, body?: unknown) {
  return app.request(`/api/admin${path}`, body === undefined ? { method } : json(method, body));
}

/**
 * A 3×2 map:   . g w      (0,0) path   (1,0) grass   (2,0) water
 *              @ . T      (0,1) spawn  (1,1) path    (2,1) tree
 */
function pond(overrides: Partial<MapInput> = {}): MapInput {
  return {
    name: "ちいさな池",
    width: 3,
    height: 2,
    tiles: ["path", "grass", "water", "path", "path", "tree"],
    spawn: { x: 0, y: 1 },
    encounters: [],
    exits: [],
    ...overrides,
  };
}

async function createMap(app: TestApp, input: MapInput = pond()): Promise<string> {
  const res = await admin(app, "POST", "/maps", input);
  if (res.status !== 201) throw new Error(`creating a map: ${await res.text()}`);
  return ((await res.json()) as AdminMap).id;
}

function exit(at: Position, mapId: string, position: Position): MapExit {
  return { at, to: { mapId, position } };
}

function putSave(app: TestApp, save: SaveData) {
  return app.request("/api/save", json("PUT", save));
}

function travel(app: TestApp, body?: unknown) {
  return app.request("/api/travel", body === undefined ? { method: "POST" } : json("POST", body));
}

async function saved(app: TestApp): Promise<SaveData> {
  return (await (await app.request("/api/save")).json()) as SaveData;
}

async function refusal(
  res: Response | Promise<Response>,
): Promise<{ status: number; error: unknown }> {
  const answered = await res;
  return { status: answered.status, error: ((await answered.json()) as { error: unknown }).error };
}

/** Where the starter map's door is in these tests: the path tile right of the spawn. */
const DOOR: Position = { x: 2, y: 1 };

/** A pond, and a door to it on the starter map that arrives at the pond's (1,1). */
async function withDoorToPond(app: TestApp, input: MapInput = pond()): Promise<string> {
  const id = await createMap(app, input);
  await setStarterExits(app, [exit(DOOR, id, { x: 1, y: 1 })]);
  return id;
}

// ---------------------------------------------------------------------------

describe("POST /api/travel", () => {
  it("takes the player through the exit they are standing on", async () => {
    const { app, db } = setup();
    const id = await withDoorToPond(app);
    await putSave(app, { mapId: START_MAP_ID, position: DOOR });

    const res = await travel(app);
    expect(res.status).toBe(200);
    const arrived = { mapId: id, position: { x: 1, y: 1 } };
    expect(await res.json()).toEqual(arrived);
    expect(await saved(app)).toEqual(arrived);
    expect(db.select().from(saves).all()).toHaveLength(1);
  });

  it("decides where to from its own record: a body that names somewhere else changes nothing", async () => {
    const { app } = setup();
    const id = await withDoorToPond(app);
    const other = await createMap(app);
    await putSave(app, { mapId: START_MAP_ID, position: DOOR });

    const res = await travel(app, { mapId: other, position: { x: 0, y: 0 }, to: other });
    expect(await res.json()).toEqual({ mapId: id, position: { x: 1, y: 1 } });
  });

  it("goes by the position the server has stored, not by where the player says they are", async () => {
    const { app } = setup();
    await withDoorToPond(app);
    // Saved one tile short of the door.
    await putSave(app, { mapId: START_MAP_ID, position: { x: 1, y: 1 } });

    expect(await refusal(travel(app, { position: DOOR }))).toEqual({
      status: 400,
      error: { kind: "no_exit_here" },
    });
    expect(await saved(app)).toEqual({ mapId: START_MAP_ID, position: { x: 1, y: 1 } });
  });

  it("refuses when there is no exit under the player, including for a player who never saved", async () => {
    const { app, db } = setup();
    expect(await refusal(travel(app))).toEqual({ status: 400, error: { kind: "no_exit_here" } });
    // Asking wrote nothing.
    expect(db.select().from(saves).all()).toEqual([]);
  });

  it("lets a player who never saved through an exit on the tile a new game starts on", async () => {
    const { app } = setup();
    const id = await createMap(app);
    await setStarterExits(app, [exit(starter().spawn, id, { x: 0, y: 0 })]);

    expect(await (await travel(app)).json()).toEqual({ mapId: id, position: { x: 0, y: 0 } });
  });

  it("is one way: arriving does not make a way back", async () => {
    const { app } = setup();
    await withDoorToPond(app);
    await putSave(app, { mapId: START_MAP_ID, position: DOOR });
    await travel(app);

    expect(await refusal(travel(app))).toEqual({ status: 400, error: { kind: "no_exit_here" } });
  });

  it("goes back through an exit on the other side, when there is one", async () => {
    const { app } = setup();
    // The pond's exit at (0,0) leads back next to the starter map's door.
    const id = await createMap(
      app,
      pond({ exits: [exit({ x: 0, y: 0 }, START_MAP_ID, { x: 1, y: 1 })] }),
    );
    await setStarterExits(app, [exit(DOOR, id, { x: 0, y: 0 })]);
    await putSave(app, { mapId: START_MAP_ID, position: DOOR });

    // Arrives standing on the pond's exit: nothing happens until asked again.
    expect(await (await travel(app)).json()).toEqual({ mapId: id, position: { x: 0, y: 0 } });
    expect(await saved(app)).toEqual({ mapId: id, position: { x: 0, y: 0 } });
    expect(await (await travel(app)).json()).toEqual({
      mapId: START_MAP_ID,
      position: { x: 1, y: 1 },
    });
  });

  it("can lead to another tile of the same map", async () => {
    const { app } = setup();
    await setStarterExits(app, [exit(DOOR, START_MAP_ID, { x: 4, y: 3 })]);
    await putSave(app, { mapId: START_MAP_ID, position: DOOR });
    expect(await (await travel(app)).json()).toEqual({
      mapId: START_MAP_ID,
      position: { x: 4, y: 3 },
    });
  });

  it("puts the player where battles there are fought", async () => {
    const { app } = setup({ random: rolls(0) });
    // Only drop lives at the pond, and the door arrives on its grass.
    const id = await createMap(app, pond({ encounters: [{ speciesId: "drop", weight: 1 }] }));
    await setStarterExits(app, [exit(DOOR, id, { x: 1, y: 0 })]);
    await putSave(app, { mapId: START_MAP_ID, position: DOOR });
    await travel(app);

    const res = await app.request("/api/battles", { method: "POST" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as BattleView).enemy.name).toBe("ヌマダマ");
  });

  it("answers 500, and moves nobody, if an exit has come to lead somewhere a player cannot be", async () => {
    const { app, db } = setup();
    const id = await withDoorToPond(app);
    await putSave(app, { mapId: START_MAP_ID, position: DOOR });
    // What the admin API refuses to do, done to the table directly: a tree
    // where the exit arrives.
    db.update(maps)
      .set({ tiles: JSON.stringify(["path", "grass", "water", "path", "tree", "tree"]) })
      .where(eq(maps.id, id))
      .run();

    expect(await refusal(travel(app))).toEqual({ status: 500, error: { kind: "broken_exit" } });
    expect(await saved(app)).toEqual({ mapId: START_MAP_ID, position: DOOR });
  });
});

describe("PUT /api/save, now that there is more than one map to be on", () => {
  it("refuses a position on another map, however walkable: a save cannot change maps", async () => {
    const { app } = setup();
    const id = await createMap(app);

    expect(await refusal(putSave(app, { mapId: id, position: { x: 0, y: 1 } }))).toEqual({
      status: 400,
      error: { kind: "wrong_map", mapId: id, current: START_MAP_ID },
    });
    expect(await saved(app)).toEqual({ mapId: START_MAP_ID, position: starter().spawn });
  });

  it("refuses it even where an exit leads: the exit has to be gone through", async () => {
    const { app } = setup();
    const id = await withDoorToPond(app);
    await putSave(app, { mapId: START_MAP_ID, position: DOOR });

    expect((await putSave(app, { mapId: id, position: { x: 1, y: 1 } })).status).toBe(400);
    expect(await saved(app)).toEqual({ mapId: START_MAP_ID, position: DOOR });
  });

  it("takes positions on the map the player has travelled to, and no longer on the one they left", async () => {
    const { app } = setup();
    const id = await withDoorToPond(app);
    await putSave(app, { mapId: START_MAP_ID, position: DOOR });
    await travel(app);

    expect((await putSave(app, { mapId: id, position: { x: 0, y: 0 } })).status).toBe(200);
    expect(await refusal(putSave(app, { mapId: START_MAP_ID, position: { x: 1, y: 1 } }))).toEqual({
      status: 400,
      error: { kind: "wrong_map", mapId: START_MAP_ID, current: id },
    });
    expect(await saved(app)).toEqual({ mapId: id, position: { x: 0, y: 0 } });
  });

  it("still does not ask how the player got to a tile of the map they are on", async () => {
    const { app } = setup();
    // From the spawn straight to the far corner of the path. Where the line
    // was drawn in Step 3, and where it still is inside a map.
    expect((await putSave(app, { mapId: START_MAP_ID, position: { x: 14, y: 10 } })).status).toBe(
      200,
    );
  });

  it("says a map does not exist before it says it is the wrong one", async () => {
    const { app } = setup();
    expect(await refusal(putSave(app, { mapId: "no-such-map", position: { x: 1, y: 1 } }))).toEqual(
      {
        status: 400,
        error: { kind: "unknown_map", mapId: "no-such-map" },
      },
    );
  });
});

describe("exits, as the admin API stores them", () => {
  it("stores a map's exits with it, and the game API serves them", async () => {
    const { app, db } = setup();
    const far = await createMap(app);
    // Sent bottom row first. They come back in reading order: top row first,
    // then left to right — which is neither the order sent nor "by x".
    const lower = exit({ x: 0, y: 1 }, far, { x: 1, y: 1 });
    const upper = exit({ x: 1, y: 0 }, far, { x: 0, y: 0 });
    const res = await admin(app, "POST", "/maps", pond({ exits: [lower, upper] }));
    expect(res.status).toBe(201);

    const created = (await res.json()) as AdminMap;
    expect(created.exits).toEqual([upper, lower]);
    expect(db.select().from(mapExits).where(eq(mapExits.mapId, created.id)).all()).toHaveLength(2);

    const served = (await (await app.request(`/api/maps/${created.id}`)).json()) as GameMap;
    expect(served.exits).toEqual([upper, lower]);
  });

  it("replaces them: an exit left out of the list is gone", async () => {
    const { app, db } = setup();
    const far = await createMap(app);
    await setStarterExits(app, [
      exit(DOOR, far, { x: 0, y: 0 }),
      exit({ x: 1, y: 1 }, far, { x: 1, y: 1 }),
    ]);
    await setStarterExits(app, [exit({ x: 1, y: 1 }, far, { x: 0, y: 1 })]);

    const rows = db.select().from(mapExits).where(eq(mapExits.mapId, START_MAP_ID)).all();
    expect(rows).toEqual([{ mapId: START_MAP_ID, x: 1, y: 1, toMapId: far, toX: 0, toY: 1 }]);
  });

  it("leaves alone the exits that arrive on a map when that map is saved", async () => {
    const { app, db } = setup();
    const id = await withDoorToPond(app);
    // Saving the pond replaces the pond's exits — not the starter map's exit to it.
    expect((await admin(app, "PUT", `/maps/${id}`, pond({ name: "おおきな池" }))).status).toBe(200);
    expect(db.select().from(mapExits).where(eq(mapExits.toMapId, id)).all()).toHaveLength(1);
  });

  describe("refuses an exit that could not be taken, and stores nothing", () => {
    it.each([
      ["from a tree", { at: { x: 2, y: 1 } }, { kind: "bad_exit", at: { x: 2, y: 1 } }],
      ["from off the map", { at: { x: 3, y: 0 } }, { kind: "bad_exit", at: { x: 3, y: 0 } }],
    ])("%s", async (_label, patch, error) => {
      const { app, db } = setup();
      const far = await createMap(app);
      const exits = [{ ...exit({ x: 0, y: 0 }, far, { x: 0, y: 0 }), ...patch }];
      expect(await refusal(admin(app, "POST", "/maps", pond({ exits })))).toEqual({
        status: 400,
        error,
      });
      expect(db.select().from(mapExits).all()).toEqual([]);
    });

    it("two on one tile", async () => {
      const { app } = setup();
      const far = await createMap(app);
      const exits = [
        exit({ x: 0, y: 0 }, far, { x: 0, y: 0 }),
        exit({ x: 0, y: 0 }, far, { x: 1, y: 1 }),
      ];
      expect(await refusal(admin(app, "POST", "/maps", pond({ exits })))).toEqual({
        status: 400,
        error: { kind: "duplicate_exit", at: { x: 0, y: 0 } },
      });
    });

    it("to a map that does not exist", async () => {
      const { app } = setup();
      const exits = [exit({ x: 0, y: 0 }, "no-such-map", { x: 0, y: 0 })];
      expect(await refusal(admin(app, "POST", "/maps", pond({ exits })))).toEqual({
        status: 400,
        error: { kind: "unknown_map", mapId: "no-such-map" },
      });
    });

    it.each([
      ["onto a tree", { x: 2, y: 1 }],
      ["into the water", { x: 2, y: 0 }],
      ["off the far map", { x: 9, y: 9 }],
      ["between tiles", { x: 0.5, y: 0 }],
    ])("that arrives %s", async (_label, position) => {
      const { app } = setup();
      const far = await createMap(app);
      const bad = exit({ x: 0, y: 0 }, far, position);
      expect(await refusal(admin(app, "POST", "/maps", pond({ exits: [bad] })))).toEqual({
        status: 400,
        error: { kind: "bad_exit_destination", exit: bad },
      });
    });

    it("with a shape that is not an exit", async () => {
      const { app } = setup();
      expect(
        await refusal(admin(app, "POST", "/maps", { ...pond(), exits: [{ at: { x: 0, y: 0 } }] })),
      ).toEqual({ status: 400, error: { kind: "malformed", at: "$.exits[0].to" } });
      const { exits: _exits, ...without } = pond();
      expect(await refusal(admin(app, "POST", "/maps", without))).toEqual({
        status: 400,
        error: { kind: "malformed", at: "$.exits" },
      });
    });
  });

  it("judges an exit back onto the same map against the tiles being saved", async () => {
    const { app } = setup();
    const id = await createMap(app);
    // (1,1) is a path now. In this edit it becomes a tree — and the exit that
    // would arrive there is in the same request.
    const tiles = [...pond().tiles];
    tiles[1 * 3 + 1] = "tree";
    const loop = exit({ x: 0, y: 0 }, id, { x: 1, y: 1 });
    expect(await refusal(admin(app, "PUT", `/maps/${id}`, pond({ tiles, exits: [loop] })))).toEqual(
      {
        status: 400,
        error: { kind: "bad_exit_destination", exit: loop },
      },
    );
    // With the tile left as it is, the same exit is fine.
    expect((await admin(app, "PUT", `/maps/${id}`, pond({ exits: [loop] }))).status).toBe(200);
  });
});

describe("a map that other maps' exits arrive on", () => {
  it("cannot be redrawn so that an exit would arrive on something unwalkable, and says whose exit", async () => {
    const { app, db } = setup();
    const id = await withDoorToPond(app);
    const tiles = [...pond().tiles];
    tiles[1 * 3 + 1] = "tree"; // where the starter map's door arrives

    expect(await refusal(admin(app, "PUT", `/maps/${id}`, pond({ tiles })))).toEqual({
      status: 400,
      error: { kind: "blocks_exit", by: [{ kind: "map", id: START_MAP_ID, name: starter().name }] },
    });
    expect(JSON.parse(db.select().from(maps).where(eq(maps.id, id)).get()?.tiles ?? "[]")).toEqual(
      pond().tiles,
    );
  });

  it("is protected from a retired map's exit as well, so that map can come back without being checked again", async () => {
    const { app } = setup();
    const id = await createMap(app);
    const other = await createMap(
      app,
      pond({ name: "むこうの池", exits: [exit({ x: 0, y: 0 }, id, { x: 1, y: 1 })] }),
    );
    expect((await admin(app, "PUT", `/maps/${other}/retired`, { retired: true })).status).toBe(200);

    const tiles = [...pond().tiles];
    tiles[1 * 3 + 1] = "tree";
    expect(await refusal(admin(app, "PUT", `/maps/${id}`, pond({ tiles })))).toEqual({
      status: 400,
      error: { kind: "blocks_exit", by: [{ kind: "map", id: other, name: "むこうの池" }] },
    });
  });

  it("can be redrawn anywhere else, and where the exit arrives as long as it stays walkable", async () => {
    const { app } = setup();
    const id = await withDoorToPond(app);
    const tiles = [...pond().tiles];
    tiles[1 * 3 + 1] = "grass";
    tiles[0] = "tree";
    expect((await admin(app, "PUT", `/maps/${id}`, pond({ tiles }))).status).toBe(200);
  });

  it("cannot be retired while a map in use has an exit to it, and can once the exit is gone", async () => {
    const { app } = setup();
    const id = await withDoorToPond(app);
    const retired = () => admin(app, "PUT", `/maps/${id}/retired`, { retired: true });

    expect(await refusal(retired())).toEqual({
      status: 400,
      error: { kind: "in_use", by: [{ kind: "map", id: START_MAP_ID, name: starter().name }] },
    });
    await setStarterExits(app, []);
    expect((await retired()).status).toBe(200);
  });

  it("is not held back by its own exit onto itself", async () => {
    const { app } = setup();
    const id = await createMap(app);
    await admin(
      app,
      "PUT",
      `/maps/${id}`,
      pond({ exits: [exit({ x: 0, y: 0 }, id, { x: 1, y: 1 })] }),
    );
    expect((await admin(app, "PUT", `/maps/${id}/retired`, { retired: true })).status).toBe(200);
  });
});

describe("a map whose exits lead somewhere retired", () => {
  it("cannot be given an exit to a retired map", async () => {
    const { app } = setup();
    const far = await createMap(app);
    await admin(app, "PUT", `/maps/${far}/retired`, { retired: true });

    const exits = [exit({ x: 0, y: 0 }, far, { x: 0, y: 0 })];
    expect(await refusal(admin(app, "POST", "/maps", pond({ exits })))).toEqual({
      status: 400,
      error: { kind: "retired_map", mapId: far },
    });
  });

  it("cannot come back while the map its exit leads to is retired, and says which", async () => {
    const { app } = setup();
    const far = await createMap(app, pond({ name: "むこうの池" }));
    const near = await createMap(app, pond({ exits: [exit({ x: 0, y: 0 }, far, { x: 0, y: 0 })] }));
    const setRetired = (id: string, retired: boolean) =>
      admin(app, "PUT", `/maps/${id}/retired`, { retired });

    // The near one first: once it is retired, nothing in use leads to the far one.
    expect((await setRetired(near, true)).status).toBe(200);
    expect((await setRetired(far, true)).status).toBe(200);

    expect(await refusal(setRetired(near, false))).toEqual({
      status: 400,
      error: { kind: "depends_on_retired", on: [{ kind: "map", id: far, name: "むこうの池" }] },
    });
    await setRetired(far, false);
    expect((await setRetired(near, false)).status).toBe(200);
  });
});
