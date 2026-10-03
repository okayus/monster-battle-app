/**
 * Retiring and restoring: the write side of "nothing is ever deleted"
 * (docs/03-data-model.md §削除しない).
 *
 * A retired row stays where it is, with a timestamp on it. What that changes
 * is decided where things are read: lists leave it out, and whatever a player
 * has that points at it falls back (`loadSave`, `loadAppearance`). This file
 * decides only whether the mark may be set or cleared.
 *
 * The rule is one sentence: **master data that is in use refers only to master
 * data that is in use.** So something still referred to cannot be retired, and
 * something that refers to a retired thing cannot be brought back. In both
 * cases the answer says what is in the way, because the person asking is an
 * admin and can go and change it.
 *
 * What players own is deliberately not part of that rule. A save on a retired
 * map, a look that wears a retired skin, a monster of a retired species: none
 * of them stops a retire. An admin cannot edit them, so refusing would leave
 * no way forward. They are handled where they are read instead.
 */

import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { err, ok } from "@mba/core";
import type { MasterReference, Result, RetireError } from "@mba/core";
import { mapEncounters, maps, moves, skins, species, speciesMoves } from "@mba/db";
import type { Db } from "@mba/db";

import { DEFAULT_SKIN_ID } from "./appearance.js";
import { START_MAP_ID } from "./maps.js";

/** What can be retired, by the name it has in the admin API's paths. */
export const RETIRABLE = ["species", "moves", "maps", "skins"] as const;
export type Retirable = (typeof RETIRABLE)[number];

export type Liveness = "missing" | "retired" | "live";

/**
 * The tables behind the four names. They share the three columns this file
 * needs, and nothing else about them matters here.
 */
const TABLES = { species, moves, maps, skins } as const;

/** Whether something exists, and if it does, whether it is still in use. */
export function livenessOf(db: Db, kind: Retirable, id: string): Liveness {
  const table = TABLES[kind];
  const row = db.select({ retiredAt: table.retiredAt }).from(table).where(eq(table.id, id)).get();
  if (row === undefined) return "missing";
  return row.retiredAt === null ? "live" : "retired";
}

// ---------------------------------------------------------------------------
// What is in the way
// ---------------------------------------------------------------------------

/** Live species that know this move. */
function speciesKnowing(db: Db, moveId: string): MasterReference[] {
  return db
    .select({ id: species.id, name: species.name })
    .from(speciesMoves)
    .innerJoin(species, eq(speciesMoves.speciesId, species.id))
    .where(and(eq(speciesMoves.moveId, moveId), isNull(species.retiredAt)))
    .orderBy(asc(species.name), asc(species.id))
    .all()
    .map((row) => ({ kind: "species", id: row.id, name: row.name }));
}

/** Live species drawn with this skin. */
function speciesWearing(db: Db, skinId: string): MasterReference[] {
  return db
    .select({ id: species.id, name: species.name })
    .from(species)
    .where(and(eq(species.skinId, skinId), isNull(species.retiredAt)))
    .orderBy(asc(species.name), asc(species.id))
    .all()
    .map((row) => ({ kind: "species", id: row.id, name: row.name }));
}

/** Live maps this species turns up on. */
function mapsListing(db: Db, speciesId: string): MasterReference[] {
  return db
    .select({ id: maps.id, name: maps.name })
    .from(mapEncounters)
    .innerJoin(maps, eq(mapEncounters.mapId, maps.id))
    .where(and(eq(mapEncounters.speciesId, speciesId), isNull(maps.retiredAt)))
    .orderBy(asc(maps.name), asc(maps.id))
    .all()
    .map((row) => ({ kind: "map", id: row.id, name: row.name }));
}

/** The retired skin and moves a species refers to. */
function retiredUnderSpecies(db: Db, speciesId: string): MasterReference[] {
  const skin = db
    .select({ id: skins.id, name: skins.name })
    .from(species)
    .innerJoin(skins, eq(species.skinId, skins.id))
    .where(and(eq(species.id, speciesId), isNotNull(skins.retiredAt)))
    .all()
    .map((row): MasterReference => ({ kind: "skin", id: row.id, name: row.name }));
  const known = db
    .select({ id: moves.id, name: moves.name })
    .from(speciesMoves)
    .innerJoin(moves, eq(speciesMoves.moveId, moves.id))
    .where(and(eq(speciesMoves.speciesId, speciesId), isNotNull(moves.retiredAt)))
    .orderBy(asc(moves.name), asc(moves.id))
    .all()
    .map((row): MasterReference => ({ kind: "move", id: row.id, name: row.name }));
  return [...skin, ...known];
}

/** The retired species a map lists. */
function retiredOnMap(db: Db, mapId: string): MasterReference[] {
  return db
    .select({ id: species.id, name: species.name })
    .from(mapEncounters)
    .innerJoin(species, eq(mapEncounters.speciesId, species.id))
    .where(and(eq(mapEncounters.mapId, mapId), isNotNull(species.retiredAt)))
    .orderBy(asc(species.name), asc(species.id))
    .all()
    .map((row) => ({ kind: "species", id: row.id, name: row.name }));
}

function whyNotRetire(db: Db, kind: Retirable, id: string): RetireError | undefined {
  // The two rows everything else falls back to. Retiring one would leave a
  // retired map's players, or a retired skin's wearers, with nowhere to go.
  if (kind === "maps" && id === START_MAP_ID) return { kind: "protected" };
  if (kind === "skins" && id === DEFAULT_SKIN_ID) return { kind: "protected" };

  const by =
    kind === "moves"
      ? speciesKnowing(db, id)
      : kind === "skins"
        ? speciesWearing(db, id)
        : kind === "species"
          ? mapsListing(db, id)
          : // Nothing in the master data refers to a map.
            [];
  return by.length === 0 ? undefined : { kind: "in_use", by };
}

function whyNotRestore(db: Db, kind: Retirable, id: string): RetireError | undefined {
  const on =
    kind === "species"
      ? retiredUnderSpecies(db, id)
      : kind === "maps"
        ? retiredOnMap(db, id)
        : // A move and a skin refer to nothing.
          [];
  return on.length === 0 ? undefined : { kind: "depends_on_retired", on };
}

// ---------------------------------------------------------------------------

/**
 * Retires something, or brings it back.
 *
 * Asking for the state it is already in changes nothing — not even the time it
 * was retired at — and is not an error: the request says what should be true,
 * and it is.
 */
export function setRetired(
  db: Db,
  kind: Retirable,
  id: string,
  retired: boolean,
  now: Date,
): Result<void, RetireError | { kind: "not_found" }> {
  const liveness = livenessOf(db, kind, id);
  if (liveness === "missing") return err({ kind: "not_found" });
  if ((liveness === "retired") === retired) return ok(undefined);

  const refusal = retired ? whyNotRetire(db, kind, id) : whyNotRestore(db, kind, id);
  if (refusal !== undefined) return err(refusal);

  const table = TABLES[kind];
  db.update(table)
    .set({ retiredAt: retired ? now : null })
    .where(eq(table.id, id))
    .run();
  return ok(undefined);
}

/**
 * The first of these ids that cannot be newly referred to, and why: it does
 * not exist, or it has been retired. Undefined if every one of them is in use.
 *
 * This is the other half of the rule at the top: saving master data that
 * points at something retired is refused, the same as retiring something that
 * is pointed at.
 */
export function firstUnusable(
  db: Db,
  kind: Retirable,
  ids: readonly string[],
): { id: string; why: "missing" | "retired" } | undefined {
  if (ids.length === 0) return undefined;
  const table = TABLES[kind];
  const rows = db
    .select({ id: table.id, retiredAt: table.retiredAt })
    .from(table)
    .where(inArray(table.id, [...ids]))
    .all();
  const found = new Map(rows.map((row) => [row.id, row.retiredAt]));
  for (const id of ids) {
    const retiredAt = found.get(id);
    if (retiredAt === undefined) return { id, why: "missing" };
    if (retiredAt !== null) return { id, why: "retired" };
  }
  return undefined;
}
