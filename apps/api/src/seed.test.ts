import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  battles,
  createDb,
  mapEncounters,
  moves,
  ownedMonsters,
  runMigrations,
  skins,
  species,
  speciesMoves,
} from "@mba/db";
import type { RenderableSkin } from "@mba/sprite";

import { DEFAULT_SKIN_ID } from "./appearance.js";
import { LOCAL_USER_ID } from "./auth.js";
import { START_MAP_ID } from "./maps.js";
import { encountersOn, findSpecies, leadMonsterOf } from "./monsters.js";
import { seed } from "./seed.js";

function fresh() {
  const db = createDb(":memory:");
  runMigrations(db);
  return db;
}

function seeded() {
  const db = fresh();
  const result = seed(db);
  if (!result.ok) throw new Error(`the seed data is invalid: ${JSON.stringify(result.error)}`);
  return db;
}

describe("seed", () => {
  it("accepts its own data: every drawing passes the validator a player's skin goes through", () => {
    expect(seed(fresh())).toEqual({ ok: true, value: undefined });
  });

  it("gives every species a skin that draws something, owned by nobody", () => {
    const db = seeded();
    const kinds = db.select().from(species).all();
    expect(kinds.length).toBeGreaterThan(0);

    for (const kind of kinds) {
      const skin = db.select().from(skins).where(eq(skins.id, kind.skinId)).get();
      expect(skin?.ownerId).toBeNull();

      const renderable = JSON.parse(skin?.renderable ?? "null") as RenderableSkin;
      const rects = renderable.parts.flatMap((part) => part.frames[0]?.rects ?? []);
      expect(rects.length).toBeGreaterThan(0);
    }
  });

  it("gives every species stats a battle can use, and at least one move", () => {
    const db = seeded();
    for (const { id } of db.select({ id: species.id }).from(species).all()) {
      const kind = findSpecies(db, id);
      expect(kind?.maxHp).toBeGreaterThan(0);
      expect(kind?.attack).toBeGreaterThan(0);
      expect(kind?.defense).toBeGreaterThan(0);
      expect(kind?.moves.length).toBeGreaterThan(0);
      for (const move of kind?.moves ?? []) expect(move.power).toBeGreaterThan(0);
    }
  });

  it("puts every species on the starter map, each with some chance of turning up", () => {
    const db = seeded();
    const encounters = encountersOn(db, START_MAP_ID);
    expect(encounters.map((entry) => entry.value.id).sort()).toEqual(
      db
        .select({ id: species.id })
        .from(species)
        .all()
        .map((row) => row.id)
        .sort(),
    );
    for (const entry of encounters) expect(entry.weight).toBeGreaterThan(0);
  });

  it("gives the player one monster to start with", () => {
    const db = seeded();
    expect(db.select().from(ownedMonsters).all()).toHaveLength(1);
    expect(leadMonsterOf(db, LOCAL_USER_ID)?.species.moves.length).toBeGreaterThan(0);
  });

  it("changes nothing when it runs again", () => {
    const db = seeded();
    const count = () => ({
      moves: db.select().from(moves).all().length,
      skins: db.select().from(skins).all().length,
      species: db.select().from(species).all().length,
      speciesMoves: db.select().from(speciesMoves).all().length,
      encounters: db.select().from(mapEncounters).all().length,
      owned: db.select().from(ownedMonsters).all().length,
      battles: db.select().from(battles).all().length,
    });
    const before = count();

    expect(seed(db).ok).toBe(true);
    expect(seed(db).ok).toBe(true);
    expect(count()).toEqual(before);
  });

  it("gives a database from before there was a default skin one, on its next boot", () => {
    const db = seeded();
    // What such a database looks like: monsters and all, but nothing to wear.
    db.delete(skins).where(eq(skins.id, DEFAULT_SKIN_ID)).run();

    expect(seed(db).ok).toBe(true);
    const skin = db.select().from(skins).where(eq(skins.id, DEFAULT_SKIN_ID)).get();
    expect(skin?.ownerId).toBeNull();
    const renderable = JSON.parse(skin?.renderable ?? "null") as RenderableSkin;
    for (const part of renderable.parts) expect(part.frames[0]?.rects.length).toBeGreaterThan(0);
  });

  it("does not put back what was removed after the first boot", () => {
    const db = seeded();
    // What an edit from the admin screen would do: this species no longer
    // appears on the starter map, and no longer knows one of its moves.
    db.delete(mapEncounters)
      .where(and(eq(mapEncounters.mapId, START_MAP_ID), eq(mapEncounters.speciesId, "rock")))
      .run();
    db.delete(speciesMoves)
      .where(and(eq(speciesMoves.speciesId, "moss"), eq(speciesMoves.moveId, "bite")))
      .run();

    expect(seed(db).ok).toBe(true);
    expect(encountersOn(db, START_MAP_ID).map((entry) => entry.value.id)).not.toContain("rock");
    expect(findSpecies(db, "moss")?.moves.map((move) => move.id)).toEqual(["bump"]);
  });
});
