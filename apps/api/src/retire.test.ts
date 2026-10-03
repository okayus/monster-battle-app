import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type {
  AdminMap,
  AdminMove,
  AdminSpecies,
  BattleView,
  MapInput,
  SaveData,
  SkinSummary,
  SpeciesInput,
  WearableSkin,
} from "@mba/core";
import { appearances, maps, moves, saves, skins, species } from "@mba/db";
import { CELLS_PER_FRAME, PART_SLOTS } from "@mba/sprite";
import type { Appearance, PaletteEntry, PartSlot } from "@mba/sprite";

import { DEFAULT_SKIN_ID } from "./appearance.js";
import { START_MAP_ID } from "./maps.js";
import { firstTile, rolls, setup, starter, visit } from "./testing.js";
import type { TestApp } from "./testing.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function admin(app: TestApp, method: string, path: string, body?: unknown) {
  return app.request(`/api/admin${path}`, body === undefined ? { method } : json(method, body));
}

type Kind = "species" | "moves" | "maps" | "skins";

function setRetired(app: TestApp, kind: Kind, id: string, retired: boolean) {
  return admin(app, "PUT", `/${kind}/${id}/retired`, { retired });
}

/** A retire that is expected to go through. */
async function retire(app: TestApp, kind: Kind, id: string): Promise<void> {
  const res = await setRetired(app, kind, id, true);
  if (res.status !== 200) throw new Error(`retiring ${kind}/${id}: ${await res.text()}`);
}

async function restore(app: TestApp, kind: Kind, id: string): Promise<void> {
  const res = await setRetired(app, kind, id, false);
  if (res.status !== 200) throw new Error(`restoring ${kind}/${id}: ${await res.text()}`);
}

async function refusal(
  res: Response | Promise<Response>,
): Promise<{ status: number; error: unknown }> {
  const answered = await res;
  return { status: answered.status, error: ((await answered.json()) as { error: unknown }).error };
}

function speciesInput(overrides: Partial<SpeciesInput> = {}): SpeciesInput {
  return {
    name: "テストダマ",
    maxHp: 30,
    attack: 11,
    defense: 7,
    skinId: "species-moss",
    moveIds: ["bump"],
    ...overrides,
  };
}

async function createSpecies(app: TestApp, overrides: Partial<SpeciesInput> = {}): Promise<string> {
  const res = await admin(app, "POST", "/species", speciesInput(overrides));
  if (res.status !== 201) throw new Error(`creating a species: ${await res.text()}`);
  return ((await res.json()) as AdminSpecies).id;
}

async function createMove(app: TestApp, name = "つつく"): Promise<string> {
  const res = await admin(app, "POST", "/moves", { name, power: 4 });
  if (res.status !== 201) throw new Error(`creating a move: ${await res.text()}`);
  return ((await res.json()) as AdminMove).id;
}

/** A 3×2 map with grass on it, and whoever is named turning up there. */
function pond(speciesIds: string[] = []): MapInput {
  return {
    name: "ちいさな池",
    width: 3,
    height: 2,
    tiles: ["path", "grass", "water", "path", "path", "tree"],
    spawn: { x: 0, y: 1 },
    encounters: speciesIds.map((speciesId) => ({ speciesId, weight: 1 })),
    exits: [],
  };
}

async function createMap(app: TestApp, input: MapInput = pond()): Promise<string> {
  const res = await admin(app, "POST", "/maps", input);
  if (res.status !== 201) throw new Error(`creating a map: ${await res.text()}`);
  return ((await res.json()) as AdminMap).id;
}

/** The starter map, with only these species left on it. */
async function leaveOnStarter(app: TestApp, speciesIds: string[]): Promise<void> {
  const map = starter();
  const res = await admin(app, "PUT", `/maps/${START_MAP_ID}`, {
    name: map.name,
    width: map.width,
    height: map.height,
    tiles: map.tiles,
    spawn: map.spawn,
    encounters: speciesIds.map((speciesId) => ({ speciesId, weight: 1 })),
    exits: [],
  });
  if (res.status !== 200) throw new Error(`editing the starter map: ${await res.text()}`);
}

const BLANK = [[0, CELLS_PER_FRAME]];

/** A skin a player drew: each named part is one row of one colour. */
async function drawSkin(
  app: TestApp,
  palette: PaletteEntry[],
  painted: Partial<Record<PartSlot, number>>,
): Promise<string> {
  const res = await app.request(
    "/api/skins",
    json("POST", {
      formatVersion: 1,
      name: "プレイヤーの絵",
      palette,
      parts: PART_SLOTS.map((slot) => {
        const index = painted[slot];
        return {
          slot,
          frames: [
            {
              durationMs: 120,
              cells:
                index === undefined
                  ? BLANK
                  : [
                      [index, 16],
                      [0, CELLS_PER_FRAME - 16],
                    ],
            },
          ],
        };
      }),
    }),
  );
  if (res.status !== 201) throw new Error(`drawing a skin: ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

const PALETTE_A: PaletteEntry[] = [
  { id: "skin", hex: "#e8b98a" },
  { id: "hair", hex: "#5a3921" },
];
const PALETTE_B: PaletteEntry[] = [{ id: "hat", hex: "#aa2200" }];

async function wear(app: TestApp, appearance: Appearance): Promise<void> {
  const res = await app.request("/api/appearance", json("PUT", appearance));
  if (res.status !== 200) throw new Error(`wearing: ${await res.text()}`);
}

async function worn(app: TestApp): Promise<Appearance> {
  return (await (await app.request("/api/appearance")).json()) as Appearance;
}

async function saved(app: TestApp): Promise<SaveData> {
  return (await (await app.request("/api/save")).json()) as SaveData;
}

type Db = ReturnType<typeof setup>["db"];

function retiredAtOf(db: Db, kind: Kind, id: string): Date | null | undefined {
  if (kind === "species")
    return db.select().from(species).where(eq(species.id, id)).get()?.retiredAt;
  if (kind === "moves") return db.select().from(moves).where(eq(moves.id, id)).get()?.retiredAt;
  if (kind === "maps") return db.select().from(maps).where(eq(maps.id, id)).get()?.retiredAt;
  return db.select().from(skins).where(eq(skins.id, id)).get()?.retiredAt;
}

// ---------------------------------------------------------------------------

describe("PUT /api/admin/:kind/:id/retired", () => {
  /** One of each kind that nothing refers to, so nothing is in the way. */
  async function unused(app: TestApp, kind: Kind): Promise<string> {
    if (kind === "moves") return createMove(app);
    if (kind === "species") return createSpecies(app);
    if (kind === "maps") return createMap(app);
    return drawSkin(app, PALETTE_A, { body: 1 });
  }

  it.each(["species", "moves", "maps", "skins"] as const)(
    "retires one of the %s and brings it back, answering with it as its list shows it",
    async (kind) => {
      const { app, db } = setup();
      const id = await unused(app, kind);

      const retired = await setRetired(app, kind, id, true);
      expect(retired.status).toBe(200);
      expect(await retired.json()).toMatchObject({ id, retired: true });
      expect(retiredAtOf(db, kind, id)).toBeInstanceOf(Date);
      const listed = (await (await admin(app, "GET", `/${kind}`)).json()) as { id: string }[];
      expect(listed.find((item) => item.id === id)).toMatchObject({ retired: true });

      const restored = await setRetired(app, kind, id, false);
      expect(restored.status).toBe(200);
      expect(await restored.json()).toMatchObject({ id, retired: false });
      expect(retiredAtOf(db, kind, id)).toBeNull();
    },
  );

  it("keeps the row: retiring deletes nothing", async () => {
    const { app, db } = setup();
    const id = await createMove(app);
    const before = db.select().from(moves).all().length;
    await retire(app, "moves", id);
    expect(db.select().from(moves).all()).toHaveLength(before);
  });

  it("is the same request however often it is sent: the time it was retired at does not move", async () => {
    const { app, db } = setup();
    const id = await createMove(app);
    await retire(app, "moves", id);
    const first = retiredAtOf(db, "moves", id);

    // Put a known, older time on the row, so that "set again" would show.
    db.update(moves)
      .set({ retiredAt: new Date(1_000_000) })
      .where(eq(moves.id, id))
      .run();
    const again = await setRetired(app, "moves", id, true);
    expect(again.status).toBe(200);
    expect(retiredAtOf(db, "moves", id)).toEqual(new Date(1_000_000));
    expect(first).toBeInstanceOf(Date);

    // Bringing back what is already in use is not an error either.
    await restore(app, "moves", id);
    expect((await setRetired(app, "moves", id, false)).status).toBe(200);
  });

  it("leaves editing and retiring apart: a PUT on the move does not bring it back", async () => {
    const { app } = setup();
    const id = await createMove(app);
    await retire(app, "moves", id);
    const edited = await admin(app, "PUT", `/moves/${id}`, { name: "つっつく", power: 6 });
    expect(await edited.json()).toEqual({ id, name: "つっつく", power: 6, retired: true });
  });

  it("answers 404 for an id that is not there", async () => {
    const { app } = setup();
    for (const kind of ["species", "moves", "maps", "skins"] as const) {
      expect(await refusal(setRetired(app, kind, "no-such-thing", true))).toEqual({
        status: 404,
        error: { kind: "not_found" },
      });
    }
  });

  it.each([
    ["a body that is not JSON", "{ not json", { kind: "bad_json" }],
    ["a word instead of true or false", { retired: "yes" }, { kind: "malformed", at: "$.retired" }],
    ["nothing said", {}, { kind: "malformed", at: "$.retired" }],
  ])("refuses %s, and changes nothing", async (_label, body, error) => {
    const { app, db } = setup();
    const id = await createMove(app);
    const res = await app.request(`/api/admin/moves/${id}/retired`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    expect(await refusal(res)).toEqual({ status: 400, error });
    expect(retiredAtOf(db, "moves", id)).toBeNull();
  });
});

describe("what master data still uses cannot be retired", () => {
  it("a move a species knows, and says which species", async () => {
    const { app, db } = setup();
    // The seed: bite is known by moss and rock.
    expect(await refusal(setRetired(app, "moves", "bite", true))).toEqual({
      status: 400,
      error: {
        kind: "in_use",
        by: [
          { kind: "species", id: "rock", name: "イワダマ" },
          { kind: "species", id: "moss", name: "モリダマ" },
        ],
      },
    });
    expect(retiredAtOf(db, "moves", "bite")).toBeNull();
  });

  it("a skin a species is drawn with", async () => {
    const { app } = setup();
    expect(await refusal(setRetired(app, "skins", "species-moss", true))).toEqual({
      status: 400,
      error: { kind: "in_use", by: [{ kind: "species", id: "moss", name: "モリダマ" }] },
    });
  });

  it("a species that turns up on a map, and says which map", async () => {
    const { app } = setup();
    expect(await refusal(setRetired(app, "species", "drop", true))).toEqual({
      status: 400,
      error: { kind: "in_use", by: [{ kind: "map", id: START_MAP_ID, name: starter().name }] },
    });
  });

  it("can be retired once nothing uses it any more", async () => {
    const { app } = setup();
    // Take bite away from the two species that know it.
    await admin(app, "PUT", "/species/moss", speciesInput({ name: "モリダマ", moveIds: ["bump"] }));
    await admin(app, "PUT", "/species/rock", speciesInput({ name: "イワダマ", moveIds: ["bump"] }));
    expect((await setRetired(app, "moves", "bite", true)).status).toBe(200);
  });

  it("is not held back by something that is itself retired", async () => {
    const { app } = setup();
    // fling is known by drop alone. With drop off the map and retired, nothing
    // that is in use knows it.
    await leaveOnStarter(app, ["moss", "rock"]);
    await retire(app, "species", "drop");
    expect((await setRetired(app, "moves", "fling", true)).status).toBe(200);
    expect((await setRetired(app, "skins", "species-drop", true)).status).toBe(200);
  });

  it("the map new games start on, and the skin new players wear: everything falls back to them", async () => {
    const { app, db } = setup();
    expect(await refusal(setRetired(app, "maps", START_MAP_ID, true))).toEqual({
      status: 400,
      error: { kind: "protected" },
    });
    expect(await refusal(setRetired(app, "skins", DEFAULT_SKIN_ID, true))).toEqual({
      status: 400,
      error: { kind: "protected" },
    });
    expect(retiredAtOf(db, "maps", START_MAP_ID)).toBeNull();
    expect(retiredAtOf(db, "skins", DEFAULT_SKIN_ID)).toBeNull();
  });
});

describe("what players have does not stand in the way of a retire", () => {
  it("a save on the map", async () => {
    const { app } = setup();
    const id = await createMap(app);
    await visit(app, id, { x: 1, y: 0 });
    expect(await saved(app)).toEqual({ mapId: id, position: { x: 1, y: 0 } });
    expect((await setRetired(app, "maps", id, true)).status).toBe(200);
  });

  it("a look that wears the skin", async () => {
    const { app } = setup();
    const a = await drawSkin(app, PALETTE_A, { body: 1 });
    await wear(app, { skinId: a, parts: {}, colours: [] });
    expect((await setRetired(app, "skins", a, true)).status).toBe(200);
  });

  it("a monster of the species", async () => {
    const { app } = setup();
    // The player's own monster is a moss.
    await leaveOnStarter(app, ["drop", "rock"]);
    expect((await setRetired(app, "species", "moss", true)).status).toBe(200);
  });
});

describe("what refers to something retired cannot come back", () => {
  it("a species that knows a retired move, and says which move", async () => {
    const { app, db } = setup();
    await leaveOnStarter(app, ["moss", "rock"]);
    await retire(app, "species", "drop");
    await retire(app, "moves", "fling");

    expect(await refusal(setRetired(app, "species", "drop", false))).toEqual({
      status: 400,
      error: {
        kind: "depends_on_retired",
        on: [{ kind: "move", id: "fling", name: "はねとばす" }],
      },
    });
    expect(retiredAtOf(db, "species", "drop")).toBeInstanceOf(Date);

    await restore(app, "moves", "fling");
    expect((await setRetired(app, "species", "drop", false)).status).toBe(200);
  });

  it("a species drawn with a retired skin", async () => {
    const { app } = setup();
    await leaveOnStarter(app, ["moss", "rock"]);
    await retire(app, "species", "drop");
    await retire(app, "skins", "species-drop");

    expect(await refusal(setRetired(app, "species", "drop", false))).toEqual({
      status: 400,
      error: {
        kind: "depends_on_retired",
        on: [{ kind: "skin", id: "species-drop", name: "ヌマダマ" }],
      },
    });
  });

  it("a map a retired species turns up on", async () => {
    const { app } = setup();
    const id = await createMap(app, pond(["drop"]));
    await retire(app, "maps", id);
    // With that map retired, only the starter still lists drop.
    await leaveOnStarter(app, ["moss", "rock"]);
    await retire(app, "species", "drop");

    expect(await refusal(setRetired(app, "maps", id, false))).toEqual({
      status: 400,
      error: {
        kind: "depends_on_retired",
        on: [{ kind: "species", id: "drop", name: "ヌマダマ" }],
      },
    });
  });
});

describe("nothing new may point at something retired", () => {
  it("a species cannot be given a retired move or a retired skin", async () => {
    const { app } = setup();
    const move = await createMove(app);
    const skin = await drawSkin(app, PALETTE_A, { body: 1 });
    await retire(app, "moves", move);
    await retire(app, "skins", skin);

    expect(
      await refusal(admin(app, "POST", "/species", speciesInput({ moveIds: [move] }))),
    ).toEqual({
      status: 400,
      error: { kind: "retired_move", moveId: move },
    });
    expect(
      await refusal(admin(app, "PUT", "/species/moss", speciesInput({ skinId: skin }))),
    ).toEqual({
      status: 400,
      error: { kind: "retired_skin", skinId: skin },
    });
  });

  it("a map cannot list a retired species", async () => {
    const { app } = setup();
    const kind = await createSpecies(app);
    await retire(app, "species", kind);
    expect(await refusal(admin(app, "POST", "/maps", pond([kind])))).toEqual({
      status: 400,
      error: { kind: "retired_species", speciesId: kind },
    });
  });

  it("still tells a thing that was retired from one that never existed", async () => {
    const { app } = setup();
    expect(
      await refusal(admin(app, "POST", "/species", speciesInput({ moveIds: ["fly"] }))),
    ).toEqual({
      status: 400,
      error: { kind: "unknown_move", moveId: "fly" },
    });
  });
});

describe("a retired skin, as the game sees it", () => {
  it("is not offered to wear, is refused in a recipe, and can still be fetched by id", async () => {
    const { app } = setup();
    const a = await drawSkin(app, PALETTE_A, { body: 1 });
    await retire(app, "skins", a);

    const wardrobe = (await (await app.request("/api/skins")).json()) as WearableSkin[];
    expect(wardrobe.map((skin) => skin.id)).not.toContain(a);
    // The admin still sees it, marked.
    const all = (await (await admin(app, "GET", "/skins")).json()) as SkinSummary[];
    expect(all.find((skin) => skin.id === a)).toMatchObject({ retired: true });

    // To someone choosing what to wear it is as if it had never been drawn.
    expect(
      await refusal(
        app.request("/api/appearance", json("PUT", { skinId: a, parts: {}, colours: [] })),
      ),
    ).toEqual({ status: 400, error: { kind: "unknown_skin", skinId: a } });

    // What is withdrawn is the offer, not the drawing.
    expect((await app.request(`/api/skins/${a}`)).status).toBe(200);
    expect((await app.request(`/api/skins/${a}/source`)).status).toBe(200);
  });

  it("puts whoever was wearing it in the default skin, and gives the look back when it returns", async () => {
    const { app, db } = setup();
    const a = await drawSkin(app, PALETTE_A, { body: 1, hair: 2 });
    const look: Appearance = { skinId: a, parts: {}, colours: [{ id: "hair", hex: "#cc3344" }] };
    await wear(app, look);

    await retire(app, "skins", a);
    expect(await worn(app)).toEqual({ skinId: DEFAULT_SKIN_ID, parts: {}, colours: [] });
    // Decided when it is read. The row still says what the player chose.
    expect(db.select().from(appearances).get()).toMatchObject({ skinId: a });

    await restore(app, "skins", a);
    expect(await worn(app)).toEqual(look);
  });

  it("gives a slot back to the worn skin when the part's skin is retired, and drops the colours that went with it", async () => {
    const { app } = setup();
    const a = await drawSkin(app, PALETTE_A, { body: 1, hair: 2 });
    const b = await drawSkin(app, PALETTE_B, { hair: 1 });
    // A, with B's hair: painted with A's "skin" and B's "hat".
    const look: Appearance = {
      skinId: a,
      parts: { hair: b },
      colours: [
        { id: "skin", hex: "#00aa00" },
        { id: "hat", hex: "#101010" },
      ],
    };
    await wear(app, look);

    await retire(app, "skins", b);
    const fallen = await worn(app);
    // A's own hair is back, "skin" is still painted, "hat" is on nothing now.
    expect(fallen).toEqual({ skinId: a, parts: {}, colours: [{ id: "skin", hex: "#00aa00" }] });
    // What comes back is a recipe the server would take as it is.
    expect((await app.request("/api/appearance", json("PUT", fallen))).status).toBe(200);
  });

  it("keeps the parts whose skins are still there", async () => {
    const { app } = setup();
    const a = await drawSkin(app, PALETTE_A, { body: 1, hair: 2 });
    const b = await drawSkin(app, PALETTE_B, { hair: 1 });
    const c = await drawSkin(app, PALETTE_B, { shoes: 1 });
    await wear(app, { skinId: a, parts: { hair: b, shoes: c }, colours: [] });

    await retire(app, "skins", b);
    expect(await worn(app)).toEqual({ skinId: a, parts: { shoes: c }, colours: [] });
  });

  it("leaves a look alone that names nothing retired", async () => {
    const { app } = setup();
    const a = await drawSkin(app, PALETTE_A, { body: 1, hair: 2 });
    const b = await drawSkin(app, PALETTE_B, { hair: 1 });
    const other = await drawSkin(app, PALETTE_B, { hair: 1 });
    const look: Appearance = {
      skinId: a,
      parts: { hair: b },
      colours: [{ id: "hat", hex: "#101010" }],
    };
    await wear(app, look);

    await retire(app, "skins", other);
    expect(await worn(app)).toEqual(look);
  });
});

describe("a retired map, as the game sees it", () => {
  it("is not there: it cannot be fetched or saved on", async () => {
    const { app } = setup();
    const id = await createMap(app);
    await retire(app, "maps", id);

    expect((await app.request(`/api/maps/${id}`)).status).toBe(404);
    expect(
      await refusal(app.request("/api/save", json("PUT", { mapId: id, position: { x: 0, y: 1 } }))),
    ).toEqual({ status: 400, error: { kind: "unknown_map", mapId: id } });
    // The admin still sees it, marked.
    const all = (await (await admin(app, "GET", "/maps")).json()) as AdminMap[];
    expect(all.find((map) => map.id === id)).toMatchObject({ retired: true });
  });

  it("sends whoever was standing on it back to the start, and puts them back when it returns", async () => {
    const { app, db } = setup();
    const id = await createMap(app);
    const there: SaveData = { mapId: id, position: { x: 1, y: 0 } };
    await visit(app, id, there.position);
    expect(await saved(app)).toEqual(there);

    await retire(app, "maps", id);
    expect(await saved(app)).toEqual({ mapId: START_MAP_ID, position: starter().spawn });
    // Decided when it is read. The row still says where the player was.
    expect(db.select().from(saves).get()).toMatchObject({ mapId: id, x: 1, y: 0 });

    await restore(app, "maps", id);
    expect(await saved(app)).toEqual(there);
  });

  it("starts no battle there: the server takes the player to be where the fallback says", async () => {
    const { app } = setup({ random: rolls(0) });
    const id = await createMap(app, pond(["drop"]));
    // On the grass of the pond, where a battle could start.
    await visit(app, id, { x: 1, y: 0 });
    expect((await app.request("/api/battles", { method: "POST" })).status).toBe(201);

    await retire(app, "maps", id);
    // Now the player is at the starter map's spawn, which is a path.
    expect(await refusal(app.request("/api/battles", { method: "POST" }))).toEqual({
      status: 400,
      error: { kind: "no_encounters_here" },
    });
  });
});

describe("a retired species and its moves, as the game sees them", () => {
  it("does not take away the monster a player has: it still fights, with the moves it knew", async () => {
    const { app } = setup({ random: rolls(0) });
    await leaveOnStarter(app, ["drop", "rock"]);
    await retire(app, "species", "moss");

    await app.request(
      "/api/save",
      json("PUT", { mapId: START_MAP_ID, position: firstTile("grass") }),
    );
    const res = await app.request("/api/battles", { method: "POST" });
    expect(res.status).toBe(201);
    const battle = (await res.json()) as BattleView;
    expect(battle.player.name).toBe("モリダマ");
    expect(battle.player.moves.map((move) => move.id)).toEqual(["bite", "bump"]);
  });

  it("is still listed for the admin, marked, with everything it had", async () => {
    const { app } = setup();
    await leaveOnStarter(app, ["drop", "rock"]);
    await retire(app, "species", "moss");

    const all = (await (await admin(app, "GET", "/species")).json()) as AdminSpecies[];
    expect(all.find((kind) => kind.id === "moss")).toMatchObject({
      retired: true,
      name: "モリダマ",
      skinId: "species-moss",
    });
    expect(
      all
        .filter((kind) => !kind.retired)
        .map((kind) => kind.id)
        .sort(),
    ).toEqual(["drop", "rock"]);
  });
});
