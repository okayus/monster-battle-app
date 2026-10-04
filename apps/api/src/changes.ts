/**
 * Everything a request can change, and the one function that changes it.
 *
 * A decision does not write (see runtime.ts). It returns a list of these —
 * what should be different afterwards, as plain values — and `commit` is what
 * turns the list into SQL. So there is one place in the API where a request
 * reaches `insert`, `update` or `delete`, and it is this file: a route is not
 * handed anything it could write with, and a decision has nothing to write
 * to.
 *
 * Being values, the changes can be looked at before they happen. A test can
 * ask a decision what it would do and compare the answer with `toEqual`, and
 * a decision that finds everything already as it should be says so by
 * returning none.
 *
 * Seeding at boot is not a request and does not come through here: "put it in
 * if it is missing" is a different rule from any of these (seed.ts).
 */

import { eq } from "drizzle-orm";

import type {
  BattleState,
  Checked,
  MapInput,
  MoveInput,
  OngoingBattle,
  SaveData,
  SpeciesInput,
} from "@mba/core";
import {
  appearances,
  battles,
  mapEncounters,
  mapExits,
  maps,
  moves,
  ownedMonsters,
  saves,
  skins,
  species,
  speciesMoves,
} from "@mba/db";
import type { Tx } from "@mba/db";
import type { Appearance, Parsed, Skin } from "@mba/sprite";

import type { UserId } from "./auth.js";
import { RETIRABLE_TABLES } from "./retirement.js";
import type { Retirable } from "./retirement.js";
import { skinRow } from "./skins.js";

declare const looked: unique symbol;

/**
 * A value whose references have been looked up: everything it names is in
 * the database, and in use.
 *
 * Like the other marks (`UserId`, `Parsed`, `Checked`) it exists only in the
 * type. It is put there by `resolved()` below, and each call to that sits at
 * the end of the decision that did the looking — which is how the third of
 * the three checks (shape, rules, references: docs/04-api-design.md) gets to
 * be something a change can ask for. A change that takes a
 * `Resolved<Checked<SpeciesInput>>` cannot be given a body that was only
 * shape-checked: there is no way to write that down.
 */
export type Resolved<T> = T & { readonly [looked]: true };

/**
 * Says of a value that what it names has just been looked up.
 *
 * A function, and not a cast written out where it is needed, because a cast
 * to `Resolved<Checked<SpeciesInput>>` would add *both* marks to whatever it
 * was given — and so let a species that never saw `checkSpecies` through.
 * This adds the one mark and keeps what was there: hand it a value that was
 * checked and it gives back one that was checked and resolved; hand it one
 * that was not, and what comes back still is not.
 */
export function resolved<T>(value: T): Resolved<T> {
  return value as Resolved<T>;
}

export type Change =
  /**
   * The player is somewhere else now. Whether they may be there is not asked
   * here: whoever decided this had its own reason to believe so — a save
   * checked the walk, an exit was read off the map, a lost battle sends the
   * player to the starting point.
   */
  | { kind: "player_placed"; userId: UserId; at: SaveData }
  /** A battle has begun. It can only begin as one that is still going on. */
  | { kind: "battle_begun"; id: string; userId: UserId; monsterId: string; state: OngoingBattle }
  /** A turn was played: the battle is in this state now, at whatever stage that is. */
  | { kind: "battle_advanced"; id: string; state: BattleState }
  /** What a finished battle left its monster with: the two numbers that are stored. */
  | { kind: "monster_settled"; id: string; exp: number; damage: number }
  /** A player saved a drawing. It is a new skin: skins are never drawn over. */
  | { kind: "skin_drawn"; id: string; ownerId: UserId; skin: Parsed<Skin> }
  /** A player chose what to wear: the recipe, replacing the one before. */
  | { kind: "look_chosen"; userId: UserId; appearance: Resolved<Parsed<Appearance>> }
  /** An admin created or replaced a move. A move refers to nothing, so "checked" is all it need be. */
  | { kind: "move_saved"; id: string; input: Checked<MoveInput> }
  /** An admin created or replaced a species, together with the moves it knows. */
  | { kind: "species_saved"; id: string; input: Resolved<Checked<SpeciesInput>> }
  /** An admin created or replaced a map, together with who turns up on it and its exits. */
  | { kind: "map_saved"; id: string; input: Resolved<Checked<MapInput>> }
  /** Something was retired, or brought back. The row stays either way: nothing is ever deleted. */
  | { kind: "retired_set"; what: Retirable; id: string; retired: boolean };

/**
 * A battle's state as its row holds it. `status` is one field of the state,
 * copied out into a column so that "the battles that are still going on" is
 * something SQL can ask (docs/03-data-model.md). Both are written from the
 * same value here, so the copy cannot come to disagree with what it was
 * copied from.
 */
function stored(state: BattleState) {
  return { status: state.status, state: JSON.stringify(state) };
}

/**
 * A species and the moves it knows are one thing to the person editing them:
 * a species row with last time's moves still attached would be a state nobody
 * asked for. The moves are replaced, not merged, so unticking one in the form
 * is how it gets removed.
 *
 * (The rows of a link table are the one thing a request ever deletes. They say
 * "this species knows this move", and nothing refers to them. The species and
 * the move themselves stay: docs/03-data-model.md §削除しない.)
 */
function saveSpecies(tx: Tx, id: string, input: SpeciesInput): void {
  const row = {
    name: input.name,
    maxHp: input.maxHp,
    attack: input.attack,
    defense: input.defense,
    skinId: input.skinId,
  };
  tx.insert(species)
    .values({ id, ...row })
    .onConflictDoUpdate({ target: species.id, set: row })
    .run();
  tx.delete(speciesMoves).where(eq(speciesMoves.speciesId, id)).run();
  for (const moveId of input.moveIds) {
    tx.insert(speciesMoves).values({ speciesId: id, moveId }).run();
  }
}

/**
 * A map with its encounters and its exits, for the same reason a species is
 * saved with its moves: they are edited as one thing. Both lists are replaced,
 * so leaving a species or an exit out is how it goes away.
 */
function saveMap(tx: Tx, id: string, input: MapInput): void {
  const row = {
    name: input.name,
    width: input.width,
    height: input.height,
    tiles: JSON.stringify(input.tiles),
    spawnX: input.spawn.x,
    spawnY: input.spawn.y,
  };
  tx.insert(maps)
    .values({ id, ...row })
    .onConflictDoUpdate({ target: maps.id, set: row })
    .run();
  tx.delete(mapEncounters).where(eq(mapEncounters.mapId, id)).run();
  for (const { speciesId, weight } of input.encounters) {
    tx.insert(mapEncounters).values({ mapId: id, speciesId, weight }).run();
  }
  // Only the exits that leave this map. Exits that arrive here belong to
  // the maps they leave from.
  tx.delete(mapExits).where(eq(mapExits.mapId, id)).run();
  for (const { at, to } of input.exits) {
    tx.insert(mapExits)
      .values({
        mapId: id,
        x: at.x,
        y: at.y,
        toMapId: to.mapId,
        toX: to.position.x,
        toY: to.position.y,
      })
      .run();
  }
}

function apply(tx: Tx, change: Change, now: Date): void {
  switch (change.kind) {
    case "player_placed": {
      // One row per player, so this replaces.
      const { mapId, position } = change.at;
      const values = { mapId, x: position.x, y: position.y, updatedAt: now };
      tx.insert(saves)
        .values({ userId: change.userId, ...values })
        .onConflictDoUpdate({ target: saves.userId, set: values })
        .run();
      return;
    }
    case "battle_begun":
      tx.insert(battles)
        .values({
          id: change.id,
          userId: change.userId,
          monsterId: change.monsterId,
          ...stored(change.state),
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return;
    case "battle_advanced":
      tx.update(battles)
        .set({ ...stored(change.state), updatedAt: now })
        .where(eq(battles.id, change.id))
        .run();
      return;
    case "monster_settled":
      tx.update(ownedMonsters)
        .set({ exp: change.exp, damage: change.damage })
        .where(eq(ownedMonsters.id, change.id))
        .run();
      return;
    case "skin_drawn":
      tx.insert(skins)
        .values(skinRow(change.id, change.ownerId, change.skin, now))
        .run();
      return;
    case "look_chosen": {
      // One row per user, so choosing again never adds a second.
      const { skinId, parts, colours } = change.appearance;
      const values = {
        skinId,
        partOverrides: JSON.stringify(parts),
        colourOverrides: JSON.stringify(colours),
        updatedAt: now,
      };
      tx.insert(appearances)
        .values({ userId: change.userId, ...values })
        .onConflictDoUpdate({ target: appearances.userId, set: values })
        .run();
      return;
    }
    case "move_saved": {
      const row = { name: change.input.name, power: change.input.power };
      tx.insert(moves)
        .values({ id: change.id, ...row })
        .onConflictDoUpdate({ target: moves.id, set: row })
        .run();
      return;
    }
    case "species_saved":
      return saveSpecies(tx, change.id, change.input);
    case "map_saved":
      return saveMap(tx, change.id, change.input);
    case "retired_set": {
      const table = RETIRABLE_TABLES[change.what];
      tx.update(table)
        .set({ retiredAt: change.retired ? now : null })
        .where(eq(table.id, change.id))
        .run();
      return;
    }
    default:
      // Every kind is written above. A kind added to `Change` and not given
      // its SQL stops compiling on this line.
      return change satisfies never;
  }
}

/**
 * Writes the changes, in the order they were decided.
 *
 * It takes a transaction and nothing else, so it cannot be called outside
 * one: a list of changes is written whole or not at all. An empty list writes
 * nothing, which is what makes a request that asks for what is already true
 * safe to send again.
 *
 * `now` is the one moment the whole list is stamped with.
 */
export function commit(tx: Tx, changes: readonly Change[], now: Date): void {
  for (const change of changes) apply(tx, change, now);
}
