/**
 * Monsters: reading species, encounters and a player's monsters out of the
 * database, in the shapes the battle rules use (`@mba/core`).
 */

import { asc, eq } from "drizzle-orm";

import type {
  AdminMove,
  AdminSpecies,
  MoveInput,
  OwnedMonster,
  Species,
  SpeciesInput,
  Weighted,
} from "@mba/core";
import { mapEncounters, moves, ownedMonsters, species, speciesMoves } from "@mba/db";
import type { Db } from "@mba/db";

/**
 * A species, for a battle. Retired or not: retiring a species stops it from
 * being offered, it does not take away the monster a player already has. That
 * monster looks its species up here, and goes on fighting.
 */
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

// ---------------------------------------------------------------------------
// What the admin API reads and writes
// ---------------------------------------------------------------------------

/** A species with the mark an admin needs to see: whether it has been retired. */
export function findAdminSpecies(db: Db, id: string): AdminSpecies | undefined {
  const found = findSpecies(db, id);
  if (found === undefined) return undefined;
  const row = db
    .select({ retiredAt: species.retiredAt })
    .from(species)
    .where(eq(species.id, id))
    .get();
  return { ...found, retired: row?.retiredAt != null };
}

/** Every species, retired or not. */
export function listSpecies(db: Db): AdminSpecies[] {
  const ids = db
    .select({ id: species.id })
    .from(species)
    .orderBy(asc(species.name), asc(species.id))
    .all();

  const all: AdminSpecies[] = [];
  for (const { id } of ids) {
    const found = findAdminSpecies(db, id);
    if (found !== undefined) all.push(found);
  }
  return all;
}

/** Every move, retired or not. */
export function listMoves(db: Db): AdminMove[] {
  return db
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

export function findMove(db: Db, id: string): AdminMove | undefined {
  const row = db.select().from(moves).where(eq(moves.id, id)).get();
  if (row === undefined) return undefined;
  return { id: row.id, name: row.name, power: row.power, retired: row.retiredAt !== null };
}

/**
 * Creates or replaces a move. Whether it is retired is not part of what is
 * saved here: editing a move leaves that as it was.
 */
export function saveMove(db: Db, id: string, input: MoveInput): void {
  const row = { name: input.name, power: input.power };
  db.insert(moves)
    .values({ id, ...row })
    .onConflictDoUpdate({ target: moves.id, set: row })
    .run();
}

/**
 * Creates or replaces a species together with the moves it knows.
 *
 * One transaction, because a species and its moves are one thing to the
 * person editing them: a species row with last time's moves still attached
 * would be a state nobody asked for. The moves are replaced, not merged, so
 * unticking one in the form is how it gets removed.
 */
export function saveSpecies(db: Db, id: string, input: SpeciesInput): void {
  const row = {
    name: input.name,
    maxHp: input.maxHp,
    attack: input.attack,
    defense: input.defense,
    skinId: input.skinId,
  };
  db.transaction((tx) => {
    tx.insert(species)
      .values({ id, ...row })
      .onConflictDoUpdate({ target: species.id, set: row })
      .run();
    tx.delete(speciesMoves).where(eq(speciesMoves.speciesId, id)).run();
    for (const moveId of input.moveIds) {
      tx.insert(speciesMoves).values({ speciesId: id, moveId }).run();
    }
  });
}
