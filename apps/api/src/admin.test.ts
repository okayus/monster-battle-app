import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { calcDamage } from "@mba/core";
import type {
  AdminMap,
  AdminMove,
  AdminSpecies,
  BattleView,
  MapInput,
  SaveData,
  SkinSummary,
  Species,
  SpeciesInput,
  TileKind,
  TurnOutcome,
} from "@mba/core";
import { maps, moves, skins, species, users } from "@mba/db";

import { LOCAL_USER_ID } from "./auth.js";
import { START_MAP_ID } from "./maps.js";
import { encountersOn, findSpecies } from "./monsters.js";
import { seed } from "./seed.js";
import { firstTile, rolls, setup, starter } from "./testing.js";
import type { TestApp } from "./testing.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof setup>["db"];

function send(app: TestApp, method: string, path: string, body?: unknown) {
  return app.request(`/api/admin${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

function speciesInput(overrides: Partial<SpeciesInput> = {}): SpeciesInput {
  return {
    name: "テストダマ",
    maxHp: 30,
    attack: 11,
    defense: 7,
    skinId: "species-moss",
    moveIds: ["bump", "fling"],
    ...overrides,
  };
}

/** The starter map as the admin API would be sent it. */
function starterInput(overrides: Partial<MapInput> = {}): MapInput {
  const map = starter();
  return {
    name: map.name,
    width: map.width,
    height: map.height,
    tiles: [...map.tiles],
    spawn: map.spawn,
    encounters: [
      { speciesId: "drop", weight: 3 },
      { speciesId: "moss", weight: 5 },
      { speciesId: "rock", weight: 2 },
    ],
    ...overrides,
  };
}

function demote(db: Db): void {
  db.update(users).set({ isAdmin: false }).where(eq(users.id, LOCAL_USER_ID)).run();
}

function putSave(app: TestApp, save: SaveData) {
  return app.request("/api/save", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(save),
  });
}

async function startBattle(app: TestApp): Promise<BattleView> {
  const res = await app.request("/api/battles", { method: "POST" });
  if (res.status !== 201) throw new Error(`expected 201, got ${res.status}`);
  return (await res.json()) as BattleView;
}

// ---------------------------------------------------------------------------

describe("the admin guard", () => {
  const routes: [string, string, unknown][] = [
    ["GET", "/species", undefined],
    ["POST", "/species", speciesInput()],
    ["PUT", "/species/moss", speciesInput()],
    ["GET", "/maps", undefined],
    ["POST", "/maps", starterInput()],
    ["PUT", `/maps/${START_MAP_ID}`, starterInput({ name: "書きかえた" })],
    ["GET", "/moves", undefined],
    ["POST", "/moves", { name: "つつく", power: 4 }],
    ["PUT", "/moves/bump", { name: "ぶつかる", power: 9 }],
    ["GET", "/skins", undefined],
    ["PUT", "/species/moss/retired", { retired: true }],
    ["PUT", "/moves/bump/retired", { retired: true }],
    ["PUT", `/maps/${START_MAP_ID}/retired`, { retired: true }],
    ["PUT", "/skins/species-moss/retired", { retired: true }],
    // A path nobody defined is guarded as well: the check is on the prefix.
    ["GET", "/anything-added-later", undefined],
  ];

  it.each(routes)(
    "answers 403 to someone who is not an admin: %s %s",
    async (method, path, body) => {
      const { app, db } = setup();
      demote(db);

      const res = await send(app, method, path, body);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: { kind: "forbidden" } });
    },
  );

  it("changes nothing for someone who is not an admin", async () => {
    const { app, db } = setup();
    demote(db);
    await send(app, "POST", "/species", speciesInput());
    await send(app, "PUT", "/species/moss", speciesInput());
    await send(app, "PUT", `/maps/${START_MAP_ID}`, starterInput({ name: "書きかえた" }));
    await send(app, "POST", "/moves", { name: "つつく", power: 4 });
    await send(app, "PUT", "/moves/bump", { name: "ぶつかる", power: 9 });
    await send(app, "PUT", "/skins/species-moss/retired", { retired: true });

    expect(db.select().from(species).all()).toHaveLength(3);
    expect(findSpecies(db, "moss")?.name).toBe("モリダマ");
    expect(db.select().from(maps).get()?.name).toBe(starter().name);
    expect(db.select().from(moves).all()).toHaveLength(3);
    expect(db.select().from(moves).where(eq(moves.id, "bump")).get()?.power).toBe(5);
    expect(db.select().from(skins).where(eq(skins.id, "species-moss")).get()?.retiredAt).toBeNull();
  });

  it("refuses before it looks at the body", async () => {
    const { app, db } = setup();
    demote(db);
    const res = await send(app, "POST", "/species", "{ not json");
    expect(res.status).toBe(403);
  });

  it("leaves the game API open to the same user", async () => {
    const { app, db } = setup();
    demote(db);
    expect((await app.request("/api/save")).status).toBe(200);
    expect((await app.request(`/api/maps/${START_MAP_ID}`)).status).toBe(200);
  });

  it("lets the local user in, including in a database from before the flag existed", async () => {
    const { app, db } = setup();
    expect((await send(app, "GET", "/species")).status).toBe(200);

    // What an older database looks like after the migration: the row is there,
    // the flag is the default.
    demote(db);
    expect(seed(db).ok).toBe(true);
    expect((await send(app, "GET", "/species")).status).toBe(200);
  });
});

describe("GET /api/admin/species", () => {
  it("lists every species with the moves it knows", async () => {
    const { app, db } = setup();
    const res = await send(app, "GET", "/species");
    expect(res.status).toBe(200);

    const listed = (await res.json()) as AdminSpecies[];
    expect(listed.map((kind) => kind.id).sort()).toEqual(["drop", "moss", "rock"]);
    // What a battle would use, plus the one thing only an admin is shown.
    for (const kind of listed) {
      expect(kind).toEqual({ ...findSpecies(db, kind.id), retired: false });
    }
  });
});

describe("POST /api/admin/species", () => {
  it("creates a species and answers with it", async () => {
    const { app, db } = setup();
    const res = await send(app, "POST", "/species", speciesInput());
    expect(res.status).toBe(201);

    const created = (await res.json()) as AdminSpecies;
    expect(res.headers.get("Location")).toBe(`/api/admin/species/${created.id}`);
    expect(created).toMatchObject({ name: "テストダマ", maxHp: 30, attack: 11, defense: 7 });
    expect(created.moves.map((move) => move.id)).toEqual(["bump", "fling"]);
    expect(created).toEqual({ ...findSpecies(db, created.id), retired: false });
  });

  it("chooses the id itself, whatever the body carries", async () => {
    const { app, db } = setup();
    const res = await send(app, "POST", "/species", { ...speciesInput(), id: "moss" });
    const created = (await res.json()) as Species;

    expect(created.id).not.toBe("moss");
    expect(findSpecies(db, "moss")?.name).toBe("モリダマ");
    expect(db.select().from(species).all()).toHaveLength(4);
  });
});

describe("PUT /api/admin/species/:id", () => {
  it("replaces the species, moves included", async () => {
    const { app, db } = setup();
    // The seed gives moss "bite" and "bump". This keeps neither.
    const res = await send(
      app,
      "PUT",
      "/species/moss",
      speciesInput({ name: "コケダマ", moveIds: ["fling"] }),
    );
    expect(res.status).toBe(200);

    const updated = (await res.json()) as AdminSpecies;
    expect(updated).toMatchObject({ id: "moss", name: "コケダマ", maxHp: 30 });
    expect(updated.moves.map((move) => move.id)).toEqual(["fling"]);
    expect(updated).toEqual({ ...findSpecies(db, "moss"), retired: false });
    expect(db.select().from(species).all()).toHaveLength(3);
  });

  it("answers 404 for an id it never handed out, and creates nothing", async () => {
    const { app, db } = setup();
    const res = await send(app, "PUT", "/species/no-such-species", speciesInput());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { kind: "not_found" } });
    expect(db.select().from(species).all()).toHaveLength(3);
  });

  it("does not reach into a battle that has already started", async () => {
    // The player's monster is a moss. Two battles against a drop, one started
    // before moss is edited and one after.
    const { app, db } = setup({ random: rolls(0, 1, 0, 0) });
    await putSave(app, { mapId: START_MAP_ID, position: firstTile("grass") });
    const before = findSpecies(db, "moss");
    const wild = findSpecies(db, "drop");
    const bite = before?.moves.find((move) => move.id === "bite");
    if (before === undefined || wild === undefined || bite === undefined) {
      throw new Error("the seed changed");
    }
    const earlier = await startBattle(app);

    const strong = { ...speciesInput(), name: before.name, attack: 999, moveIds: ["bite", "bump"] };
    expect((await send(app, "PUT", "/species/moss", strong)).status).toBe(200);
    const later = await startBattle(app);

    const play = async (battle: BattleView) => {
      const res = await app.request(`/api/battles/${battle.id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moveId: "bite", turn: 0 }),
      });
      return (await res.json()) as TurnOutcome;
    };

    // The earlier battle still hits with the attack it started with…
    const old = await play(earlier);
    expect(old.events[0]).toMatchObject({ damage: calcDamage(before, wild, bite, 0) });
    expect(old.battle.status).toBe("ongoing");
    // …and the later one with the new attack, which ends it in one blow.
    const fresh = await play(later);
    expect(fresh.battle.status).toBe("won");
  });

  describe("rejects with 400, and leaves the species as it was", () => {
    it.each([
      ["a body that is not JSON", "{ not json", { kind: "bad_json" }],
      [
        "a stat that is a string",
        { ...speciesInput(), maxHp: "30" },
        { kind: "malformed", at: "$.maxHp" },
      ],
      [
        "moves that are not a list",
        { ...speciesInput(), moveIds: "bump" },
        { kind: "malformed", at: "$.moveIds" },
      ],
      ["an empty name", speciesInput({ name: "" }), { kind: "bad_name" }],
      ["no health", speciesInput({ maxHp: 0 }), { kind: "bad_stat", stat: "maxHp", value: 0 }],
      [
        "a defense between whole numbers",
        speciesInput({ defense: 2.5 }),
        { kind: "bad_stat", stat: "defense", value: 2.5 },
      ],
      ["no moves", speciesInput({ moveIds: [] }), { kind: "bad_move_count", got: 0 }],
      [
        "a move listed twice",
        speciesInput({ moveIds: ["bump", "bump"] }),
        { kind: "duplicate_move", moveId: "bump" },
      ],
      [
        "a move that does not exist",
        speciesInput({ moveIds: ["fly"] }),
        { kind: "unknown_move", moveId: "fly" },
      ],
      [
        "a skin that does not exist",
        speciesInput({ skinId: "no-such-skin" }),
        { kind: "unknown_skin", skinId: "no-such-skin" },
      ],
    ])("%s", async (_label, body, error) => {
      const { app, db } = setup();
      const before = findSpecies(db, "moss");

      const res = await send(app, "PUT", "/species/moss", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
      expect(findSpecies(db, "moss")).toEqual(before);
    });
  });

  it("answers 413 for a body far larger than any species", async () => {
    const { app } = setup();
    const res = await send(app, "PUT", "/species/moss", {
      ...speciesInput(),
      junk: "x".repeat(8000),
    });
    expect(res.status).toBe(413);
  });
});

describe("POST /api/admin/moves", () => {
  it("creates a move and answers with it", async () => {
    const { app, db } = setup();
    const res = await send(app, "POST", "/moves", { name: "つつく", power: 4 });
    expect(res.status).toBe(201);

    const created = (await res.json()) as AdminMove;
    expect(res.headers.get("Location")).toBe(`/api/admin/moves/${created.id}`);
    expect(created).toEqual({ id: created.id, name: "つつく", power: 4, retired: false });
    expect(db.select().from(moves).where(eq(moves.id, created.id)).get()).toMatchObject({
      name: "つつく",
      power: 4,
      retiredAt: null,
    });
  });

  it("chooses the id itself, whatever the body carries", async () => {
    const { app, db } = setup();
    const res = await send(app, "POST", "/moves", { id: "bump", name: "つつく", power: 4 });
    const created = (await res.json()) as AdminMove;

    expect(created.id).not.toBe("bump");
    expect(db.select().from(moves).where(eq(moves.id, "bump")).get()?.name).toBe("ぶつかる");
    expect(db.select().from(moves).all()).toHaveLength(4);
  });

  it("can be given to a species straight away", async () => {
    const { app } = setup();
    const created = (await (
      await send(app, "POST", "/moves", { name: "つつく", power: 4 })
    ).json()) as AdminMove;

    const res = await send(app, "PUT", "/species/moss", speciesInput({ moveIds: [created.id] }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as AdminSpecies).moves).toEqual([
      { id: created.id, name: "つつく", power: 4 },
    ]);
  });

  describe("rejects with 400, and creates nothing", () => {
    it.each([
      ["a body that is not JSON", "{ not json", { kind: "bad_json" }],
      [
        "a power that is a string",
        { name: "つつく", power: "4" },
        { kind: "malformed", at: "$.power" },
      ],
      ["no name at all", { power: 4 }, { kind: "malformed", at: "$.name" }],
      ["an empty name", { name: " ", power: 4 }, { kind: "bad_name" }],
      ["no power", { name: "つつく", power: 0 }, { kind: "bad_power", power: 0 }],
      [
        "a power between whole numbers",
        { name: "つつく", power: 1.5 },
        { kind: "bad_power", power: 1.5 },
      ],
    ])("%s", async (_label, body, error) => {
      const { app, db } = setup();
      const res = await send(app, "POST", "/moves", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
      expect(db.select().from(moves).all()).toHaveLength(3);
    });
  });

  it("answers 413 for a body far larger than any move", async () => {
    const { app } = setup();
    const res = await send(app, "POST", "/moves", {
      name: "つつく",
      power: 4,
      junk: "x".repeat(4000),
    });
    expect(res.status).toBe(413);
  });
});

describe("PUT /api/admin/moves/:id", () => {
  it("replaces the move", async () => {
    const { app, db } = setup();
    const res = await send(app, "PUT", "/moves/bump", { name: "たいあたり", power: 9 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "bump", name: "たいあたり", power: 9, retired: false });
    expect(db.select().from(moves).all()).toHaveLength(3);
  });

  it("answers 404 for an id it never handed out, and creates nothing", async () => {
    const { app, db } = setup();
    const res = await send(app, "PUT", "/moves/no-such-move", { name: "つつく", power: 4 });
    expect(res.status).toBe(404);
    expect(db.select().from(moves).all()).toHaveLength(3);
  });

  it("refuses a move that breaks the rules, and leaves it as it was", async () => {
    const { app, db } = setup();
    const res = await send(app, "PUT", "/moves/bump", { name: "ぶつかる", power: 1000 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { kind: "bad_power", power: 1000 } });
    expect(db.select().from(moves).where(eq(moves.id, "bump")).get()?.power).toBe(5);
  });

  it("is what the next battle uses, and not one that has already started", async () => {
    const { app } = setup({ random: rolls(0) });
    await putSave(app, { mapId: START_MAP_ID, position: firstTile("grass") });
    const before = await startBattle(app);
    const powerIn = (battle: BattleView) =>
      battle.player.moves.find((move) => move.id === "bump")?.power;
    expect(powerIn(before)).toBe(5);

    await send(app, "PUT", "/moves/bump", { name: "ぶつかる", power: 9 });

    const still = (await (await app.request(`/api/battles/${before.id}`)).json()) as BattleView;
    expect(powerIn(still)).toBe(5);
    expect(powerIn(await startBattle(app))).toBe(9);
  });
});

describe("GET /api/admin/maps", () => {
  it("lists every map with who turns up on it", async () => {
    const { app } = setup();
    const res = await send(app, "GET", "/maps");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { ...starter(), encounters: starterInput().encounters, retired: false },
    ]);
  });
});

describe("POST /api/admin/maps", () => {
  const small: MapInput = {
    name: "ちいさな池",
    width: 3,
    height: 2,
    tiles: ["path", "grass", "water", "path", "path", "tree"],
    spawn: { x: 0, y: 1 },
    encounters: [{ speciesId: "drop", weight: 1 }],
  };

  it("creates a map, and the game API serves it", async () => {
    const { app } = setup();
    const res = await send(app, "POST", "/maps", small);
    expect(res.status).toBe(201);

    const created = (await res.json()) as AdminMap;
    expect(res.headers.get("Location")).toBe(`/api/admin/maps/${created.id}`);
    expect(created).toEqual({ ...small, id: created.id, retired: false });

    const served = await app.request(`/api/maps/${created.id}`);
    expect(served.status).toBe(200);
    // The game is handed the grid: not who turns up, and not the admin's mark.
    const { encounters: _encounters, retired: _retired, ...grid } = created;
    expect(await served.json()).toEqual(grid);
  });

  it("chooses the id itself, whatever the body carries", async () => {
    const { app, db } = setup();
    const res = await send(app, "POST", "/maps", { ...small, id: START_MAP_ID });
    const created = (await res.json()) as AdminMap;

    expect(created.id).not.toBe(START_MAP_ID);
    expect(db.select().from(maps).all()).toHaveLength(2);
    expect(db.select().from(maps).where(eq(maps.id, START_MAP_ID)).get()?.name).toBe(
      starter().name,
    );
  });
});

describe("PUT /api/admin/maps/:id", () => {
  it("replaces the map", async () => {
    const { app } = setup();
    const res = await send(
      app,
      "PUT",
      `/maps/${START_MAP_ID}`,
      starterInput({ name: "ひろい草原" }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as AdminMap).name).toBe("ひろい草原");

    const served = await app.request(`/api/maps/${START_MAP_ID}`);
    expect(((await served.json()) as AdminMap).name).toBe("ひろい草原");
  });

  it("answers 404 for an id it never handed out, and creates nothing", async () => {
    const { app, db } = setup();
    const res = await send(app, "PUT", "/maps/no-such-map", starterInput());
    expect(res.status).toBe(404);
    expect(db.select().from(maps).all()).toHaveLength(1);
  });

  it("sends a player back to the spawn when their tile is drawn over", async () => {
    const { app } = setup();
    const grass = firstTile("grass");
    await putSave(app, { mapId: START_MAP_ID, position: grass });

    const map = starter();
    const tiles: TileKind[] = [...map.tiles];
    tiles[grass.y * map.width + grass.x] = "water";
    expect((await send(app, "PUT", `/maps/${START_MAP_ID}`, starterInput({ tiles }))).status).toBe(
      200,
    );

    const save = (await (await app.request("/api/save")).json()) as SaveData;
    expect(save).toEqual({ mapId: START_MAP_ID, position: map.spawn });
  });

  it("replaces who turns up: a species left out of the list is gone from the map", async () => {
    const { app, db } = setup({ random: rolls(0.9) });
    await putSave(app, { mapId: START_MAP_ID, position: firstTile("grass") });

    // With the seeded weights a roll of 0.9 meets a rock. Without rock on the
    // list, the same roll lands on moss.
    const withoutRock = starterInput({
      encounters: [
        { speciesId: "drop", weight: 3 },
        { speciesId: "moss", weight: 5 },
      ],
    });
    expect((await send(app, "PUT", `/maps/${START_MAP_ID}`, withoutRock)).status).toBe(200);

    expect(encountersOn(db, START_MAP_ID).map((entry) => entry.value.id)).toEqual(["drop", "moss"]);
    expect((await startBattle(app)).enemy.name).toBe("モリダマ");
  });

  it("can leave a map with nothing living on it, and then no battle starts there", async () => {
    const { app } = setup();
    await putSave(app, { mapId: START_MAP_ID, position: firstTile("grass") });
    expect(
      (await send(app, "PUT", `/maps/${START_MAP_ID}`, starterInput({ encounters: [] }))).status,
    ).toBe(200);

    const res = await app.request("/api/battles", { method: "POST" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { kind: "no_encounters_here" } });
  });

  describe("rejects with 400, and leaves the map as it was", () => {
    const map = starter();
    const tree = firstTile("tree");

    it.each([
      ["a body that is not JSON", "{ not json", { kind: "bad_json" }],
      [
        "a tile that is not a tile",
        { ...starterInput(), tiles: ["path", "lava"] },
        { kind: "malformed", at: "$.tiles[1]" },
      ],
      ["no spawn", { ...starterInput(), spawn: undefined }, { kind: "malformed", at: "$.spawn" }],
      ["an empty name", starterInput({ name: " " }), { kind: "bad_name" }],
      [
        "a size past the limit",
        starterInput({ width: 33 }),
        { kind: "bad_size", width: 33, height: map.height },
      ],
      [
        "tiles that do not fill the grid",
        starterInput({ tiles: map.tiles.slice(1) }),
        { kind: "bad_tile_count", got: map.tiles.length - 1, expected: map.tiles.length },
      ],
      ["a spawn on a tree", starterInput({ spawn: tree }), { kind: "bad_spawn", spawn: tree }],
      [
        "a weight of zero",
        starterInput({ encounters: [{ speciesId: "moss", weight: 0 }] }),
        { kind: "bad_weight", speciesId: "moss", weight: 0 },
      ],
      [
        "a species listed twice",
        starterInput({
          encounters: [
            { speciesId: "moss", weight: 1 },
            { speciesId: "moss", weight: 2 },
          ],
        }),
        { kind: "duplicate_encounter", speciesId: "moss" },
      ],
      [
        "a species that does not exist",
        starterInput({ encounters: [{ speciesId: "ghost", weight: 1 }] }),
        { kind: "unknown_species", speciesId: "ghost" },
      ],
    ])("%s", async (_label, body, error) => {
      const { app } = setup();
      const before = await (await send(app, "GET", "/maps")).json();

      const res = await send(app, "PUT", `/maps/${START_MAP_ID}`, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
      expect(await (await send(app, "GET", "/maps")).json()).toEqual(before);
    });
  });
});

describe("what the forms choose from", () => {
  it("lists the moves, by name", async () => {
    const { app } = setup();
    const res = await send(app, "GET", "/moves");
    expect(await res.json()).toEqual([
      { id: "bite", name: "かじる", power: 6, retired: false },
      { id: "fling", name: "はねとばす", power: 7, retired: false },
      { id: "bump", name: "ぶつかる", power: 5, retired: false },
    ]);
  });

  it("lists the skins by name and owner, without the drawings", async () => {
    const { app } = setup();
    const listed = (await (await send(app, "GET", "/skins")).json()) as SkinSummary[];

    // What ships with the game: the skin a new player wears, and one per species.
    expect(listed.map((skin) => skin.id).sort()).toEqual([
      "player-default",
      "species-drop",
      "species-moss",
      "species-rock",
    ]);
    for (const skin of listed) {
      expect(Object.keys(skin).sort()).toEqual(["id", "name", "ownerId", "retired"]);
      expect(skin.ownerId).toBeNull();
      expect(skin.retired).toBe(false);
    }
  });
});
