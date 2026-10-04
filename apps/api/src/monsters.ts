/**
 * Monsters: reading species, moves, encounters and a player's monsters out of
 * the database, in the shapes the battle rules use (`@mba/core`).
 */

import { asc, eq } from "drizzle-orm";

import type { AdminMove, AdminSpecies, OwnedMonster, Species, Weighted } from "@mba/core";
import { mapEncounters, moves, ownedMonsters, species, speciesMoves } from "@mba/db";
import type { Read } from "@mba/db";

import type { UserId } from "./auth.js";

/**
 * A species, for a battle. Retired or not: retiring a species stops it from
 * being offered, it does not take away the monster a player already has. That
 * monster looks its species up here, and goes on fighting.
 */
export function findSpecies(read: Read, id: string): Species | undefined {
  const row = read.select().from(species).where(eq(species.id, id)).get();
  if (row === undefined) return undefined;

  const known = read
    .select({ id: moves.id, name: moves.name, power: moves.power })
    .from(speciesMoves)
    .innerJoin(moves, eq(speciesMoves.moveId, moves.id))
    .where(eq(speciesMoves.speciesId, id))
    // An explicit order: without one, the order of a monster's moves on screen
    // would be whatever the database happened to return.
    .orderBy(asc(moves.id))
    .all();

  return {
    id: row.id,
    name: row.name,
    maxHp: row.maxHp,
    attack: row.attack,
    defense: row.defense,
    skinId: row.skinId,
    moves: known,
  };
}

/** What can be met on a map, with the weights the pick is made by. */
export function encountersOn(read: Read, mapId: string): Weighted<Species>[] {
  const rows = read
    .select()
    .from(mapEncounters)
    .where(eq(mapEncounters.mapId, mapId))
    // Ordered, so that a given roll always means the same species.
    .orderBy(asc(mapEncounters.speciesId))
    .all();

  const entries: Weighted<Species>[] = [];
  for (const row of rows) {
    const value = findSpecies(read, row.speciesId);
    if (value !== undefined) entries.push({ value, weight: row.weight });
  }
  return entries;
}

/**
 * A player's monsters, in the order they got them.
 *
 * This is where a database row becomes the domain's `OwnedMonster`: the
 * species is looked up and attached, and the two stored numbers are passed on
 * as they are. What they amount to — a level, a health — is not decided here
 * but by the rules in `@mba/core`, each time someone needs to know.
 */
export function monstersOf(read: Read, userId: UserId): OwnedMonster[] {
  const rows = read
    .select()
    .from(ownedMonsters)
    .where(eq(ownedMonsters.userId, userId))
    // An explicit order, and one that cannot tie: "the first one" has to mean
    // the same monster every time it is asked.
    .orderBy(asc(ownedMonsters.createdAt), asc(ownedMonsters.id))
    .all();

  const owned: OwnedMonster[] = [];
  for (const row of rows) {
    const kind = findSpecies(read, row.speciesId);
    if (kind === undefined) continue;
    owned.push({
      id: row.id,
      species: kind,
      nickname: row.nickname,
      exp: row.exp,
      damage: row.damage,
    });
  }
  return owned;
}

/** The monster a player sends into battle: the first one they got. */
export function leadMonsterOf(read: Read, userId: UserId): OwnedMonster | undefined {
  return monstersOf(read, userId)[0];
}

// ---------------------------------------------------------------------------
// What the admin API reads
// ---------------------------------------------------------------------------

/** A species with the mark an admin needs to see: whether it has been retired. */
export function findAdminSpecies(read: Read, id: string): AdminSpecies | undefined {
  const found = findSpecies(read, id);
  if (found === undefined) return undefined;
  const row = read
    .select({ retiredAt: species.retiredAt })
    .from(species)
    .where(eq(species.id, id))
    .get();
  return { ...found, retired: row?.retiredAt != null };
}

/** Every species, retired or not. */
export function listSpecies(read: Read): AdminSpecies[] {
  const ids = read
    .select({ id: species.id })
    .from(species)
    .orderBy(asc(species.name), asc(species.id))
    .all();

  const all: AdminSpecies[] = [];
  for (const { id } of ids) {
    const found = findAdminSpecies(read, id);
    if (found !== undefined) all.push(found);
  }
  return all;
}

/** Every move, retired or not. */
export function listMoves(read: Read): AdminMove[] {
  return read
    .select({ id: moves.id, name: moves.name, power: moves.power, retiredAt: moves.retiredAt })
    .from(moves)
    .orderBy(asc(moves.name), asc(moves.id))
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      power: row.power,
      retired: row.retiredAt !== null,
    }));
}

export function findMove(read: Read, id: string): AdminMove | undefined {
  const row = read.select().from(moves).where(eq(moves.id, id)).get();
  if (row === undefined) return undefined;
  return { id: row.id, name: row.name, power: row.power, retired: row.retiredAt !== null };
}
