/**
 * Retiring and restoring: the write side of "nothing is ever deleted"
 * (docs/03-data-model.md §削除しない).
 *
 * A retired row stays where it is, with a timestamp on it. What that changes
 * is decided where things are read: lists leave it out, and whatever a player
 * has that points at it falls back (`loadSave`, `loadAppearance`). This file
 * decides only whether the mark may be set or cleared. Setting it is
 * `commit`'s job, like every other write a request makes (changes.ts).
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

import { and, asc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";

import { err, ok } from "@mba/core";
import type { MasterReference, Result, RetireError } from "@mba/core";
import { mapEncounters, mapExits, maps, moves, skins, species, speciesMoves } from "@mba/db";
import type { Read } from "@mba/db";

import { DEFAULT_SKIN_ID } from "./appearance.js";
import { START_MAP_ID } from "./maps.js";
import { unchanged } from "./runtime.js";
import type { Decision, World } from "./runtime.js";

/** What can be retired, by the name it has in the admin API's paths. */
export const RETIRABLE = ["species", "moves", "maps", "skins"] as const;
export type Retirable = (typeof RETIRABLE)[number];

export type Liveness = "missing" | "retired" | "live";

/**
 * The tables behind the four names. They share the three columns this file
 * needs, and nothing else about them matters here.
 */
export const RETIRABLE_TABLES = { species, moves, maps, skins } as const;

/** Whether something exists, and if it does, whether it is still in use. */
export function livenessOf(read: Read, kind: Retirable, id: string): Liveness {
  const table = RETIRABLE_TABLES[kind];
  const row = read.select({ retiredAt: table.retiredAt }).from(table).where(eq(table.id, id)).get();
  if (row === undefined) return "missing";
  return row.retiredAt === null ? "live" : "retired";
}

// ---------------------------------------------------------------------------
// What is in the way
// ---------------------------------------------------------------------------

/** Live species that know this move. */
function speciesKnowing(read: Read, moveId: string): MasterReference[] {
  return read
    .select({ id: species.id, name: species.name })
    .from(speciesMoves)
    .innerJoin(species, eq(speciesMoves.speciesId, species.id))
    .where(and(eq(speciesMoves.moveId, moveId), isNull(species.retiredAt)))
    .orderBy(asc(species.name), asc(species.id))
    .all()
    .map((row) => ({ kind: "species", id: row.id, name: row.name }));
}

/** Live species drawn with this skin. */
function speciesWearing(read: Read, skinId: string): MasterReference[] {
  return read
    .select({ id: species.id, name: species.name })
    .from(species)
    .where(and(eq(species.skinId, skinId), isNull(species.retiredAt)))
    .orderBy(asc(species.name), asc(species.id))
    .all()
    .map((row) => ({ kind: "species", id: row.id, name: row.name }));
}

/** Live maps this species turns up on. */
function mapsListing(read: Read, speciesId: string): MasterReference[] {
  return read
    .select({ id: maps.id, name: maps.name })
    .from(mapEncounters)
    .innerJoin(maps, eq(mapEncounters.mapId, maps.id))
    .where(and(eq(mapEncounters.speciesId, speciesId), isNull(maps.retiredAt)))
    .orderBy(asc(maps.name), asc(maps.id))
    .all()
    .map((row) => ({ kind: "map", id: row.id, name: row.name }));
}

/** Live maps, other than the map itself, with an exit that leads onto it. */
function mapsLeadingTo(read: Read, mapId: string): MasterReference[] {
  const rows = read
    .select({ id: maps.id, name: maps.name })
    .from(mapExits)
    .innerJoin(maps, eq(mapExits.mapId, maps.id))
    .where(and(eq(mapExits.toMapId, mapId), ne(mapExits.mapId, mapId), isNull(maps.retiredAt)))
    .orderBy(asc(maps.name), asc(maps.id))
    .all();
  // One map can have several exits to the same place; it is named once.
  const once = new Map(rows.map((row) => [row.id, row]));
  return [...once.values()].map((row) => ({ kind: "map", id: row.id, name: row.name }));
}

/** The retired maps a map's exits lead to. */
function retiredBeyond(read: Read, mapId: string): MasterReference[] {
  const rows = read
    .select({ id: maps.id, name: maps.name })
    .from(mapExits)
    .innerJoin(maps, eq(mapExits.toMapId, maps.id))
    .where(and(eq(mapExits.mapId, mapId), ne(mapExits.toMapId, mapId), isNotNull(maps.retiredAt)))
    .orderBy(asc(maps.name), asc(maps.id))
    .all();
  const once = new Map(rows.map((row) => [row.id, row]));
  return [...once.values()].map((row) => ({ kind: "map", id: row.id, name: row.name }));
}

/** The retired skin and moves a species refers to. */
function retiredUnderSpecies(read: Read, speciesId: string): MasterReference[] {
  const skin = read
    .select({ id: skins.id, name: skins.name })
    .from(species)
    .innerJoin(skins, eq(species.skinId, skins.id))
    .where(and(eq(species.id, speciesId), isNotNull(skins.retiredAt)))
    .all()
    .map((row): MasterReference => ({ kind: "skin", id: row.id, name: row.name }));
  const known = read
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
function retiredOnMap(read: Read, mapId: string): MasterReference[] {
  return read
    .select({ id: species.id, name: species.name })
    .from(mapEncounters)
    .innerJoin(species, eq(mapEncounters.speciesId, species.id))
    .where(and(eq(mapEncounters.mapId, mapId), isNotNull(species.retiredAt)))
    .orderBy(asc(species.name), asc(species.id))
    .all()
    .map((row) => ({ kind: "species", id: row.id, name: row.name }));
}

function whyNotRetire(read: Read, kind: Retirable, id: string): RetireError | undefined {
  // The two rows everything else falls back to. Retiring one would leave a
  // retired map's players, or a retired skin's wearers, with nowhere to go.
  if (kind === "maps" && id === START_MAP_ID) return { kind: "protected" };
  if (kind === "skins" && id === DEFAULT_SKIN_ID) return { kind: "protected" };

  const by =
    kind === "moves"
      ? speciesKnowing(read, id)
      : kind === "skins"
        ? speciesWearing(read, id)
        : kind === "species"
          ? mapsListing(read, id)
          : // What refers to a map is another map, through an exit.
            mapsLeadingTo(read, id);
  return by.length === 0 ? undefined : { kind: "in_use", by };
}

function whyNotRestore(read: Read, kind: Retirable, id: string): RetireError | undefined {
  const on =
    kind === "species"
      ? retiredUnderSpecies(read, id)
      : kind === "maps"
        ? [...retiredOnMap(read, id), ...retiredBeyond(read, id)]
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
 * and it is. That shows in what this returns: no changes. The same request
 * sent five times decides something once, and then nothing four times.
 */
export function setRetired(
  { read }: Pick<World, "read">,
  kind: Retirable,
  id: string,
  retired: boolean,
): Result<Decision<void>, RetireError | { kind: "not_found" }> {
  const liveness = livenessOf(read, kind, id);
  if (liveness === "missing") return err({ kind: "not_found" });
  if ((liveness === "retired") === retired) return ok(unchanged(undefined));

  const refusal = retired ? whyNotRetire(read, kind, id) : whyNotRestore(read, kind, id);
  if (refusal !== undefined) return err(refusal);

  return ok({ answer: undefined, changes: [{ kind: "retired_set", what: kind, id, retired }] });
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
  read: Read,
  kind: Retirable,
  ids: readonly string[],
): { id: string; why: "missing" | "retired" } | undefined {
  if (ids.length === 0) return undefined;
  const table = RETIRABLE_TABLES[kind];
  const rows = read
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
