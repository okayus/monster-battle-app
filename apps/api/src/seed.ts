/**
 * What a brand-new database needs before the game can be played: the local
 * user, a map to stand on, monsters to meet, and one monster to start with.
 *
 * All of this is master data that the admin screen will own (Step 5 in
 * docs/05-roadmap.md). Until then there is no other way to create it, so it is
 * seeded at boot — and only into a database that does not have it yet. Once a
 * row exists, the database is the truth and this file is only where it began.
 */

import { eq } from "drizzle-orm";

import { err, ok } from "@mba/core";
import type { Result } from "@mba/core";
import { mapEncounters, moves, ownedMonsters, skins, species, speciesMoves } from "@mba/db";
import type { Db } from "@mba/db";
import { CELLS_PER_FRAME, PART_SLOTS, packFrame, parseSkin } from "@mba/sprite";
import type { PaletteEntry, Skin, SkinError } from "@mba/sprite";

import { LOCAL_USER_ID, ensureLocalUser } from "./auth.js";
import { START_MAP_ID, ensureStarterMap } from "./maps.js";
import type { MapArtError } from "./maps.js";
import { skinRow } from "./skins.js";

export type SeedError =
  | MapArtError
  | { kind: "bad_monster_skin"; species: string; error: SkinError };

const MOVES = [
  { id: "bump", name: "ぶつかる", power: 5 },
  { id: "bite", name: "かじる", power: 6 },
  { id: "fling", name: "はねとばす", power: 7 },
];

interface SpeciesSeed {
  id: string;
  name: string;
  maxHp: number;
  attack: number;
  defense: number;
  moveIds: string[];
  /** How often it turns up on the starter map, relative to the others. */
  weight: number;
  palette: PaletteEntry[];
  /** One string per row. `.` is transparent, a digit n is `palette[n - 1]`. */
  art: string[];
}

const SPECIES: SpeciesSeed[] = [
  {
    id: "moss",
    name: "モリダマ",
    maxHp: 24,
    attack: 9,
    defense: 9,
    moveIds: ["bump", "bite"],
    weight: 5,
    palette: [
      { id: "body", hex: "#6fae4f" },
      { id: "shade", hex: "#4d8a36" },
      { id: "eye", hex: "#1e2a1a" },
      { id: "belly", hex: "#a9d67f" },
    ],
    art: [
      "................",
      "................",
      ".....222222.....",
      "....21111112....",
      "...2111111112...",
      "..211111111112..",
      "..211311113112..",
      "..211311113112..",
      "..211111111112..",
      "..211144441112..",
      "..211444444112..",
      "...2114444112...",
      "....22111122....",
      ".....222222.....",
      "................",
      "................",
    ],
  },
  {
    id: "drop",
    name: "ヌマダマ",
    maxHp: 20,
    attack: 10,
    defense: 8,
    moveIds: ["bump", "fling"],
    weight: 3,
    palette: [
      { id: "body", hex: "#4a90d9" },
      { id: "shade", hex: "#2f6bb0" },
      { id: "eye", hex: "#16233a" },
      { id: "shine", hex: "#bfe0ff" },
    ],
    art: [
      "................",
      ".......22.......",
      "......2112......",
      "......2112......",
      ".....211112.....",
      ".....214112.....",
      "....21411112....",
      "....21111112....",
      "...2113113112...",
      "...2113113112...",
      "...2111111112...",
      "...2111111112...",
      "....21111112....",
      ".....222222.....",
      "................",
      "................",
    ],
  },
  {
    id: "rock",
    name: "イワダマ",
    maxHp: 28,
    attack: 8,
    defense: 12,
    moveIds: ["bump", "bite"],
    weight: 2,
    palette: [
      { id: "body", hex: "#9a9a9a" },
      { id: "shade", hex: "#6b6b6b" },
      { id: "eye", hex: "#222222" },
      { id: "light", hex: "#c8c8c8" },
    ],
    art: [
      "................",
      "................",
      "................",
      "....2222222.....",
      "...244411112....",
      "..24411111112...",
      "..241111111112..",
      "..211311131112..",
      "..211311131112..",
      "..211111111112..",
      "..211111111122..",
      "..221111111122..",
      "...2222222222...",
      "................",
      "................",
      "................",
    ],
  },
];

/** The monster a new player is given. */
const STARTER_SPECIES_ID = "moss";

/** A monster has one pose, so the duration never shows. Any valid value will do. */
const FRAME_MS = 120;

/**
 * Turns a drawing into a Skin by the same route a player's drawing takes:
 * through `parseSkin`. The drawing is not checked separately here. A short
 * row, a stray character or a colour that is not in the palette all come back
 * as the validator's own errors, so the skins that ship with the game are held
 * to exactly the rules a player's are.
 */
function monsterSkin(kind: SpeciesSeed): Result<Skin, SkinError> {
  const grid = kind.art.flatMap((row) => [...row].map((char) => (char === "." ? 0 : Number(char))));
  const blank = packFrame(new Array<number>(CELLS_PER_FRAME).fill(0), FRAME_MS);
  return parseSkin({
    formatVersion: 1,
    name: kind.name,
    palette: kind.palette,
    // A monster is drawn whole on the first layer; the format still requires
    // every slot, so the others are sent transparent.
    parts: PART_SLOTS.map((slot) => ({
      slot,
      frames: [slot === "body" ? packFrame(grid, FRAME_MS) : blank],
    })),
  });
}

function skinIdOf(speciesId: string): string {
  return `species-${speciesId}`;
}

/**
 * Seeds the monsters, but only into a database that has none. Checking "is
 * there any species" instead of inserting row by row matters for the tables
 * that link things together: if an admin removes a move from a species, a
 * row-by-row seed would put it back on the next boot.
 */
function seedMonsters(db: Db, now: Date): Result<void, SeedError> {
  if (db.select({ id: species.id }).from(species).get() !== undefined) return ok(undefined);

  // Every drawing is validated before anything is written.
  const drawn: { kind: SpeciesSeed; skin: Skin }[] = [];
  for (const kind of SPECIES) {
    const skin = monsterSkin(kind);
    if (!skin.ok) return err({ kind: "bad_monster_skin", species: kind.id, error: skin.error });
    drawn.push({ kind, skin: skin.value });
  }

  // All or nothing: a half-seeded database would look seeded to the check above.
  db.transaction((tx) => {
    for (const move of MOVES) tx.insert(moves).values(move).onConflictDoNothing().run();

    for (const { kind, skin } of drawn) {
      const skinId = skinIdOf(kind.id);
      // No owner: these ship with the game.
      tx.insert(skins)
        .values(skinRow(skinId, null, skin, now))
        .onConflictDoNothing()
        .run();
      tx.insert(species)
        .values({
          id: kind.id,
          name: kind.name,
          maxHp: kind.maxHp,
          attack: kind.attack,
          defense: kind.defense,
          skinId,
        })
        .run();
      for (const moveId of kind.moveIds) {
        tx.insert(speciesMoves).values({ speciesId: kind.id, moveId }).run();
      }
      tx.insert(mapEncounters)
        .values({ mapId: START_MAP_ID, speciesId: kind.id, weight: kind.weight })
        .run();
    }
  });
  return ok(undefined);
}

/** Gives a player their first monster, if they have none. */
function ensureStarterMonster(db: Db, userId: string, now: Date): void {
  const owned = db
    .select({ id: ownedMonsters.id })
    .from(ownedMonsters)
    .where(eq(ownedMonsters.userId, userId))
    .get();
  if (owned !== undefined) return;

  db.insert(ownedMonsters)
    .values({
      id: crypto.randomUUID(),
      userId,
      speciesId: STARTER_SPECIES_ID,
      nickname: null,
      createdAt: now,
    })
    .run();
}

/**
 * Everything, in dependency order. Runs on every boot and in every test, and
 * changes nothing in a database that is already set up.
 */
export function seed(db: Db): Result<void, SeedError> {
  const now = new Date();
  ensureLocalUser(db);

  const map = ensureStarterMap(db);
  if (!map.ok) return map;

  const monsters = seedMonsters(db, now);
  if (!monsters.ok) return monsters;

  ensureStarterMonster(db, LOCAL_USER_ID, now);
  return ok(undefined);
}
