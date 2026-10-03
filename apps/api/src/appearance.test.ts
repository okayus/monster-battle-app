import { describe, expect, it } from "vitest";

import type { WearableSkin } from "@mba/core";
import { appearances, skins, users } from "@mba/db";
import { APPEARANCE_SPEC, CELLS_PER_FRAME, PART_SLOTS } from "@mba/sprite";
import type { Appearance, PaletteEntry, PartSlot, RenderableSkin } from "@mba/sprite";

import { DEFAULT_SKIN_ID } from "./appearance.js";
import { LOCAL_USER_ID } from "./auth.js";
import { setup } from "./testing.js";
import type { TestApp } from "./testing.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BLANK = [[0, CELLS_PER_FRAME]];

/** One row of a colour across the top of the canvas, and nothing else. */
function stripe(paletteIndex: number): number[][] {
  return [
    [paletteIndex, 16],
    [0, CELLS_PER_FRAME - 16],
  ];
}

/**
 * Saves a skin the way the editor would, and returns its id. `painted` says
 * which colour each part is drawn in; a part that is not named stays blank.
 */
async function draw(
  app: TestApp,
  palette: PaletteEntry[],
  painted: Partial<Record<PartSlot, number>>,
): Promise<string> {
  const res = await app.request("/api/skins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      formatVersion: 1,
      name: "fixture",
      palette,
      parts: PART_SLOTS.map((slot) => {
        const index = painted[slot];
        return {
          slot,
          frames: [{ durationMs: 120, cells: index === undefined ? BLANK : stripe(index) }],
        };
      }),
    }),
  });
  if (res.status !== 201) throw new Error(`expected 201, got ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

/** skin, hair and shirt are painted with. `unused` is in the palette and on no cell. */
const PALETTE_A: PaletteEntry[] = [
  { id: "skin", hex: "#e8b98a" },
  { id: "hair", hex: "#5a3921" },
  { id: "shirt", hex: "#3f7bd6" },
  { id: "unused", hex: "#00ff00" },
];
const PAINTED_A = { body: 1, hair: 2, shirt: 3 } as const;

/** Shares "hair" with A and has a colour of its own on its hair part. */
const PALETTE_B: PaletteEntry[] = [
  { id: "hair", hex: "#222222" },
  { id: "hat", hex: "#aa2200" },
];
const PAINTED_B = { body: 1, hair: 2 } as const;

function put(app: TestApp, body: unknown, headers: Record<string, string> = {}) {
  return app.request("/api/appearance", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** What GET /api/appearance answers right now. */
async function current(app: TestApp): Promise<Appearance> {
  const res = await app.request("/api/appearance");
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  return (await res.json()) as Appearance;
}

/** A PUT that is expected to be refused: the status and the error it carries. */
async function refusal(app: TestApp, body: unknown): Promise<{ status: number; error: unknown }> {
  const res = await put(app, body);
  return { status: res.status, error: ((await res.json()) as { error: unknown }).error };
}

const DEFAULT_LOOK: Appearance = { skinId: DEFAULT_SKIN_ID, parts: {}, colours: [] };

// ---------------------------------------------------------------------------

describe("GET /api/appearance", () => {
  it("dresses a player who never chose in the default skin, without writing anything", async () => {
    const { app, db } = setup();
    expect(await current(app)).toEqual(DEFAULT_LOOK);
    expect(db.select().from(appearances).all()).toEqual([]);
  });

  it("names a default skin that exists and has something drawn on every part", async () => {
    const { app } = setup();
    const res = await app.request(`/api/skins/${DEFAULT_SKIN_ID}`);
    expect(res.status).toBe(200);

    const skin = (await res.json()) as RenderableSkin;
    expect(skin.parts.map((part) => part.slot)).toEqual([...PART_SLOTS]);
    for (const part of skin.parts) {
      expect(part.frames[0]?.rects.length, part.slot).toBeGreaterThan(0);
    }
  });

  it("returns what was chosen", async () => {
    const { app } = setup();
    const a = await draw(app, PALETTE_A, PAINTED_A);
    const look = { skinId: a, parts: {}, colours: [{ id: "hair", hex: "#cc3344" }] };
    await put(app, look);
    expect(await current(app)).toEqual(look);
  });
});

describe("PUT /api/appearance", () => {
  it("stores the recipe and echoes it back", async () => {
    const { app, db } = setup();
    const a = await draw(app, PALETTE_A, PAINTED_A);
    const b = await draw(app, PALETTE_B, PAINTED_B);
    // A's body and shirt under B's hair, which is painted with B's "hat".
    const look: Appearance = {
      skinId: a,
      parts: { hair: b },
      colours: [
        { id: "shirt", hex: "#cc3344" },
        { id: "hat", hex: "#101010" },
      ],
    };

    const res = await put(app, look);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(look);

    const rows = db.select().from(appearances).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: LOCAL_USER_ID, skinId: a });
    expect(JSON.parse(rows[0]?.partOverrides ?? "null")).toEqual({ hair: b });
    expect(JSON.parse(rows[0]?.colourOverrides ?? "null")).toEqual(look.colours);
  });

  it("stores a recipe, not a drawing: a few dozen bytes whatever is worn", async () => {
    const { app, db } = setup();
    const a = await draw(app, PALETTE_A, PAINTED_A);
    await put(app, { skinId: a, parts: {}, colours: [{ id: "hair", hex: "#cc3344" }] });

    const row = db.select().from(appearances).get();
    const stored = `${row?.skinId}${row?.partOverrides}${row?.colourOverrides}`;
    expect(stored.length).toBeLessThan(100);
    expect(stored).not.toContain("rects");
  });

  it("replaces the recipe instead of adding another", async () => {
    const { app, db } = setup();
    const a = await draw(app, PALETTE_A, PAINTED_A);
    const b = await draw(app, PALETTE_B, PAINTED_B);

    await put(app, { skinId: a, parts: { hair: b }, colours: [{ id: "hat", hex: "#101010" }] });
    await put(app, { skinId: b, parts: {}, colours: [] });

    expect(db.select().from(appearances).all()).toHaveLength(1);
    // Nothing of the first recipe is left: a PUT is the whole recipe.
    expect(await current(app)).toEqual({ skinId: b, parts: {}, colours: [] });
  });

  it("is the caller's look, whatever the body says about whose it is", async () => {
    const { app, db } = setup();
    const a = await draw(app, PALETTE_A, PAINTED_A);

    const res = await put(app, { skinId: a, parts: {}, colours: [], userId: "someone-else" });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain("someone-else");

    const rows = db.select().from(appearances).all();
    expect(rows.map((row) => row.userId)).toEqual([LOCAL_USER_ID]);
  });

  it("writes a look down one way: a slot taken from the worn skin is not kept", async () => {
    const { app } = setup();
    const a = await draw(app, PALETTE_A, PAINTED_A);
    const res = await put(app, { skinId: a, parts: { hair: a, shirt: a }, colours: [] });
    expect(await res.json()).toEqual({ skinId: a, parts: {}, colours: [] });
  });

  it("lets any skin be worn, including the ones that ship with the game", async () => {
    const { app } = setup();
    const a = await draw(app, PALETTE_A, PAINTED_A);

    expect((await put(app, { skinId: "species-moss", parts: {}, colours: [] })).status).toBe(200);
    const mixed = {
      skinId: DEFAULT_SKIN_ID,
      parts: { hair: a, shoes: "species-rock" },
      colours: [],
    };
    expect((await put(app, mixed)).status).toBe(200);
    expect(await current(app)).toEqual(mixed);
  });

  it("refuses a colour of the worn skin that the swapped-out part was the only one to use", async () => {
    const { app } = setup();
    const a = await draw(app, PALETTE_A, PAINTED_A);
    const b = await draw(app, PALETTE_B, PAINTED_B);
    // A paints only its hair with "hair", and that part is B's now. B has a
    // "hair" of its own, but paints its body with it, which is not worn.
    expect(
      await refusal(app, {
        skinId: a,
        parts: { hair: b },
        colours: [{ id: "hair", hex: "#cc3344" }],
      }),
    ).toEqual({ status: 400, error: { kind: "unknown_colour", id: "hair" } });
  });

  it("accepts a colour that only a swapped-in part is painted with", async () => {
    const { app } = setup();
    const a = await draw(app, PALETTE_A, PAINTED_A);
    const b = await draw(app, PALETTE_B, PAINTED_B);
    // "hat" is B's alone, and B's hair is painted with it.
    const res = await put(app, {
      skinId: a,
      parts: { hair: b },
      colours: [{ id: "hat", hex: "#101010" }],
    });
    expect(res.status).toBe(200);
  });

  describe("refuses what is not a recipe", () => {
    it("a body that is not JSON", async () => {
      const { app } = setup();
      expect(await refusal(app, "{ not json")).toEqual({
        status: 400,
        error: { kind: "bad_json" },
      });
    });

    it.each([
      ["no skin", { parts: {}, colours: [] }, "$.skinId"],
      [
        "a slot the format does not have",
        { skinId: "x", parts: { hat: "y" }, colours: [] },
        "$.parts",
      ],
      [
        "colours keyed by id",
        { skinId: "x", parts: {}, colours: { hair: "#cc3344" } },
        "$.colours",
      ],
    ])("%s", async (_label, body, at) => {
      const { app } = setup();
      expect(await refusal(app, body)).toEqual({ status: 400, error: { kind: "malformed", at } });
    });

    it("a colour that is not plain hex — before it could reach a stylesheet", async () => {
      const { app, db } = setup();
      const a = await draw(app, PALETTE_A, PAINTED_A);
      const hex = "url(https://example.invalid/x.svg#a)";
      expect(await refusal(app, { skinId: a, parts: {}, colours: [{ id: "hair", hex }] })).toEqual({
        status: 400,
        error: { kind: "bad_hex", hex },
      });
      expect(db.select().from(appearances).all()).toEqual([]);
    });

    it("a colour id that could not be a CSS variable name", async () => {
      const { app } = setup();
      const a = await draw(app, PALETTE_A, PAINTED_A);
      const id = "hair;color:red";
      expect(
        await refusal(app, { skinId: a, parts: {}, colours: [{ id, hex: "#cc3344" }] }),
      ).toEqual({ status: 400, error: { kind: "bad_palette_id", id } });
    });

    it("more colours than a skin can have", async () => {
      const { app } = setup();
      const a = await draw(app, PALETTE_A, PAINTED_A);
      const colours = Array.from({ length: APPEARANCE_SPEC.maxColours + 1 }, (_, i) => ({
        id: `c${i}`,
        hex: "#123456",
      }));
      expect(await refusal(app, { skinId: a, parts: {}, colours })).toEqual({
        status: 400,
        error: {
          kind: "too_many",
          what: "colours",
          got: colours.length,
          max: APPEARANCE_SPEC.maxColours,
        },
      });
    });

    it("a body over the size limit, before reading it", async () => {
      const { app } = setup();
      const res = await put(app, { skinId: "x".repeat(8 * 1024), parts: {}, colours: [] });
      expect(res.status).toBe(413);
      expect(((await res.json()) as { error: { kind: string } }).error.kind).toBe("body_too_large");
    });
  });

  describe("refuses a recipe that names what is not there", () => {
    it("a skin that does not exist", async () => {
      const { app } = setup();
      expect(await refusal(app, { skinId: "no-such-skin", parts: {}, colours: [] })).toEqual({
        status: 400,
        error: { kind: "unknown_skin", skinId: "no-such-skin" },
      });
    });

    it("a part from a skin that does not exist, and says which", async () => {
      const { app } = setup();
      const a = await draw(app, PALETTE_A, PAINTED_A);
      expect(
        await refusal(app, {
          skinId: a,
          parts: { shirt: DEFAULT_SKIN_ID, hair: "gone" },
          colours: [],
        }),
      ).toEqual({ status: 400, error: { kind: "unknown_skin", skinId: "gone" } });
    });

    it("a colour none of the skins have", async () => {
      const { app } = setup();
      const a = await draw(app, PALETTE_A, PAINTED_A);
      expect(
        await refusal(app, { skinId: a, parts: {}, colours: [{ id: "hat", hex: "#101010" }] }),
      ).toEqual({ status: 400, error: { kind: "unknown_colour", id: "hat" } });
    });

    it("a colour the skin has in its palette but paints nothing with", async () => {
      const { app } = setup();
      const a = await draw(app, PALETTE_A, PAINTED_A);
      expect(
        await refusal(app, { skinId: a, parts: {}, colours: [{ id: "unused", hex: "#101010" }] }),
      ).toEqual({ status: 400, error: { kind: "unknown_colour", id: "unused" } });
    });

    it("a colour of the worn skin, once every part of it has been swapped out", async () => {
      const { app } = setup();
      const a = await draw(app, PALETTE_A, PAINTED_A);
      const b = await draw(app, PALETTE_B, PAINTED_B);
      const everything = Object.fromEntries(PART_SLOTS.map((slot) => [slot, b]));
      // "shirt" is A's, and nothing of A is drawn any more.
      expect(
        await refusal(app, {
          skinId: a,
          parts: everything,
          colours: [{ id: "shirt", hex: "#101010" }],
        }),
      ).toEqual({ status: 400, error: { kind: "unknown_colour", id: "shirt" } });
    });

    it("and leaves the look as it was", async () => {
      const { app } = setup();
      const a = await draw(app, PALETTE_A, PAINTED_A);
      const look = { skinId: a, parts: {}, colours: [{ id: "hair", hex: "#cc3344" }] };
      await put(app, look);

      await put(app, { skinId: "no-such-skin", parts: {}, colours: [] });
      await put(app, { skinId: a, parts: {}, colours: [{ id: "hat", hex: "#101010" }] });
      await put(app, { skinId: a, parts: {}, colours: [{ id: "hair", hex: "red" }] });

      expect(await current(app)).toEqual(look);
    });
  });
});

describe("GET /api/skins", () => {
  it("lists every skin by name, and says which ones the caller drew", async () => {
    const { app } = setup();
    const a = await draw(app, PALETTE_A, PAINTED_A);

    const res = await app.request("/api/skins");
    expect(res.status).toBe(200);
    const listed = (await res.json()) as WearableSkin[];

    expect(listed.find((skin) => skin.id === a)).toEqual({ id: a, name: "fixture", mine: true });
    expect(listed.find((skin) => skin.id === DEFAULT_SKIN_ID)).toEqual({
      id: DEFAULT_SKIN_ID,
      name: "はじめのすがた",
      mine: false,
    });
    expect(
      listed
        .filter((skin) => !skin.mine)
        .map((skin) => skin.id)
        .sort(),
    ).toEqual([DEFAULT_SKIN_ID, "species-drop", "species-moss", "species-rock"]);
  });

  it("does not call a skin the caller's because somebody drew it", async () => {
    const { app, db } = setup();
    // Another player and a skin of theirs. There is no way to become a second
    // user through the API yet, so the rows are written directly.
    db.insert(users)
      .values({ id: "another-player", displayName: "べつの人", createdAt: new Date() })
      .run();
    db.insert(skins)
      .values({
        id: "theirs",
        ownerId: "another-player",
        name: "べつの人の絵",
        formatVersion: 1,
        source: "{}",
        renderable: "{}",
        createdAt: new Date(),
      })
      .run();

    const listed = (await (await app.request("/api/skins")).json()) as WearableSkin[];
    expect(listed.find((skin) => skin.id === "theirs")).toEqual({
      id: "theirs",
      name: "べつの人の絵",
      mine: false,
    });
    // Whose it is stays on the server.
    expect(JSON.stringify(listed)).not.toContain("another-player");
  });

  it("hands out names only: no drawing, and nobody's user id", async () => {
    const { app } = setup();
    await draw(app, PALETTE_A, PAINTED_A);
    const listed = (await (await app.request("/api/skins")).json()) as WearableSkin[];

    for (const skin of listed) expect(Object.keys(skin).sort()).toEqual(["id", "mine", "name"]);
    expect(JSON.stringify(listed)).not.toContain(LOCAL_USER_ID);
  });
});
