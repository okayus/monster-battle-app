/**
 * Monsters: reading species, encounters and a player's monsters out of the
 * database, in the shapes the battle rules use (`@mba/core`).
 */

import { asc, eq } from "drizzle-orm";

import type { OwnedMonster, Species, Weighted } from "@mba/core";
import { mapEncounters, moves, ownedMonsters, species, speciesMoves } from "@mba/db";
import type { Db } from "@mba/db";

export function findSpecies(db: Db, id: string): Species | undefined {
  const row = db.select().from(species).where(eq(species.id, id)).get();
  if (row === undefined) return undefined;

  const known = db
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
export function encountersOn(db: Db, mapId: string): Weighted<Species>[] {
  const rows = db
    .select()
    .from(mapEncounters)
    .where(eq(mapEncounters.mapId, mapId))
    // Ordered, so that a given roll always means the same species.
    .orderBy(asc(mapEncounters.speciesId))
    .all();

  const entries: Weighted<Species>[] = [];
  for (const row of rows) {
    const value = findSpecies(db, row.speciesId);
    if (value !== undefined) entries.push({ value, weight: row.weight });
  }
  return entries;
}

/** The monster a player sends into battle: the first one they got. */
export function leadMonsterOf(db: Db, userId: string): OwnedMonster | undefined {
  const row = db
    .select()
    .from(ownedMonsters)
    .where(eq(ownedMonsters.userId, userId))
    .orderBy(asc(ownedMonsters.createdAt), asc(ownedMonsters.id))
    .get();
  if (row === undefined) return undefined;

  const kind = findSpecies(db, row.speciesId);
  if (kind === undefined) return undefined;
  return { id: row.id, species: kind, nickname: row.nickname };
}
