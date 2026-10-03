import { eq, isNotNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { skins } from "@mba/db";
import { CELLS_PER_FRAME, PART_SLOTS, SKIN_SPEC, parseSkin, toRenderable } from "@mba/sprite";
import type { RenderableSkin, Skin } from "@mba/sprite";

import { LOCAL_USER_ID } from "./auth.js";
import { setup } from "./testing.js";
import type { TestApp as App } from "./testing.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A structurally valid payload, as it would arrive from the editor. */
function validInput(): Record<string, unknown> {
  return {
    formatVersion: 1,
    name: "fixture",
    palette: [
      { id: "skin", hex: "#e8b98a" },
      { id: "hair", hex: "#5a3921" },
    ],
    parts: PART_SLOTS.map((slot) => ({
      slot,
      frames: [
        {
          durationMs: 120,
          cells:
            slot === "body"
              ? [
                  [0, 100],
                  [1, 56],
                  [2, 100],
                ]
              : [[0, CELLS_PER_FRAME]],
        },
      ],
    })),
  };
}

/** Applies one mutation to an otherwise valid payload. */
function inputWith(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...validInput(), ...patch };
}

/** What parseSkin makes of a payload — the value the API is expected to store. */
function parsed(input: unknown): Skin {
  const result = parseSkin(input);
  if (!result.ok) throw new Error(`fixture is invalid: ${JSON.stringify(result.error)}`);
  return result.value;
}

function post(app: App, body: unknown, headers: Record<string, string> = {}) {
  return app.request("/api/skins", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

type Db = ReturnType<typeof setup>["db"];

/**
 * The skins players have saved. The table is not empty to begin with — the
 * skins that ship with the game are in it, with no owner — so "nothing was
 * stored" has to mean "nothing with an owner".
 */
function savedByPlayers(db: Db) {
  return db.select().from(skins).where(isNotNull(skins.ownerId)).all();
}

function skinById(db: Db, id: string) {
  return db.select().from(skins).where(eq(skins.id, id)).get();
}

/** Saves a payload that is expected to be accepted, and returns its new id. */
async function save(app: App, body: unknown): Promise<string> {
  const res = await post(app, body);
  if (res.status !== 201) throw new Error(`expected 201, got ${res.status}`);
  const { id } = (await res.json()) as { id: string };
  return id;
}

// ---------------------------------------------------------------------------

describe("GET /api/health", () => {
  it("answers, and reports the migrations this boot applied", async () => {
    const { app, applied } = setup();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", migrationsApplied: applied });
    expect(applied).toBeGreaterThan(0);
  });
});

describe("POST /api/skins", () => {
  it("stores a valid skin and says where to find it", async () => {
    const { app, db } = setup();
    const res = await post(app, validInput());

    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(res.headers.get("Location")).toBe(`/api/skins/${id}`);

    const rows = savedByPlayers(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);
    expect(rows[0]?.name).toBe("fixture");
    expect(rows[0]?.formatVersion).toBe(1);
  });

  it("stores what parseSkin rebuilt and what toRenderable derived, not the request body", async () => {
    const { app, db } = setup();
    const hostile = inputWith({
      evil: "<script>alert(1)</script>",
      palette: [
        { id: "skin", hex: "#e8b98a", onload: "alert(1)" },
        { id: "hair", hex: "#5a3921" },
      ],
    });
    const id = await save(app, hostile);

    const row = skinById(db, id);
    const skin = parsed(hostile);
    expect(row?.source).toBe(JSON.stringify(skin));
    expect(row?.renderable).toBe(JSON.stringify(toRenderable(skin)));

    const stored = `${row?.source}${row?.renderable}`;
    expect(stored).not.toContain("evil");
    expect(stored).not.toContain("onload");
    expect(stored).not.toContain("script");
  });

  it("decides the owner on the server, whatever the body claims", async () => {
    const { app, db } = setup();
    const id = await save(app, inputWith({ ownerId: "someone-else", owner_id: "someone-else" }));
    expect(skinById(db, id)?.ownerId).toBe(LOCAL_USER_ID);
  });

  it("gives every skin its own id", async () => {
    const { app } = setup();
    const first = await save(app, validInput());
    const second = await save(app, validInput());
    expect(second).not.toBe(first);
  });

  describe("rejects with 400, and stores nothing", () => {
    const palette = (entry: Record<string, unknown>) => ({ palette: [entry] });

    it.each([
      [
        "a colour that could escape the fill attribute",
        palette({ id: "skin", hex: "url(#evil)" }),
        { kind: "bad_hex", hex: "url(#evil)" },
      ],
      [
        "a palette id that could escape the CSS variable name",
        palette({ id: "x;color:red", hex: "#123456" }),
        { kind: "bad_palette_id", id: "x;color:red" },
      ],
      [
        "a skin with a slot missing",
        { parts: (validInput().parts as unknown[]).slice(0, 4) },
        { kind: "missing_slot", slot: "hair" },
      ],
      [
        "an unknown format version",
        { formatVersion: 2 },
        { kind: "malformed", at: "$.formatVersion" },
      ],
    ])("%s", async (_label, patch, error) => {
      const { app, db } = setup();
      const res = await post(app, inputWith(patch));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
      expect(savedByPlayers(db)).toEqual([]);
    });

    it("a body that is not JSON", async () => {
      const { app, db } = setup();
      const res = await post(app, "{ not json");
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { kind: "bad_json" } });
      expect(savedByPlayers(db)).toEqual([]);
    });

    it("a JSON body that is not a skin", async () => {
      const { app } = setup();
      const res = await post(app, "null");
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { kind: "malformed", at: "$" } });
    });
  });

  describe("answers 413 for a body over the limit, without parsing it", () => {
    const oversized = JSON.stringify({ junk: "x".repeat(SKIN_SPEC.maxBytes) });
    const tooLarge = { error: { kind: "body_too_large", max: SKIN_SPEC.maxBytes } };

    it("when the size is declared up front", async () => {
      const { app, db } = setup();
      const res = await post(app, oversized, { "Content-Length": String(oversized.length) });
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual(tooLarge);
      expect(savedByPlayers(db)).toEqual([]);
    });

    it("when the body is streamed with no declared size", async () => {
      const { app } = setup();
      const res = await post(app, oversized);
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual(tooLarge);
    });
  });
});

describe("GET /api/skins/:id", () => {
  it("returns the render-ready form of what was saved", async () => {
    const { app } = setup();
    const id = await save(app, validInput());

    const res = await app.request(`/api/skins/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(await res.json()).toEqual(toRenderable(parsed(validInput())));
  });

  it("serves the parts in draw order, however the editor sent them", async () => {
    const { app } = setup();
    const reversed = inputWith({ parts: [...(validInput().parts as unknown[])].reverse() });
    const id = await save(app, reversed);

    const res = await app.request(`/api/skins/${id}`);
    const body = (await res.json()) as RenderableSkin;
    expect(body.parts.map((part) => part.slot)).toEqual([...PART_SLOTS]);
  });

  it("answers 404 for an id that was never saved", async () => {
    const { app } = setup();
    const res = await app.request("/api/skins/no-such-skin");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { kind: "not_found" } });
  });
});

describe("GET /api/skins/:id/source", () => {
  it("returns the editable form: the skin as parseSkin rebuilt it", async () => {
    const { app } = setup();
    const id = await save(app, validInput());

    const res = await app.request(`/api/skins/${id}/source`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(await res.json()).toEqual(parsed(validInput()));
  });

  it("can be saved again as it is: what comes out is something parseSkin accepts", async () => {
    const { app } = setup();
    const first = await save(app, validInput());
    const source: unknown = await (await app.request(`/api/skins/${first}/source`)).json();

    const second = await save(app, source);
    expect(second).not.toBe(first);
    const again = await (await app.request(`/api/skins/${second}`)).json();
    expect(again).toEqual(toRenderable(parsed(validInput())));
  });

  it("never carries what the validator dropped", async () => {
    const { app } = setup();
    const id = await save(app, inputWith({ evil: "<script>alert(1)</script>" }));
    const text = await (await app.request(`/api/skins/${id}/source`)).text();
    expect(text).not.toContain("evil");
    expect(text).not.toContain("script");
  });

  it("serves the skins that ship with the game as well", async () => {
    const { app } = setup();
    const res = await app.request("/api/skins/species-moss/source");
    expect(res.status).toBe(200);
    expect(parseSkin(await res.json()).ok).toBe(true);
  });

  it("answers 404 for an id that was never saved", async () => {
    const { app } = setup();
    const res = await app.request("/api/skins/no-such-skin/source");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { kind: "not_found" } });
  });
});
