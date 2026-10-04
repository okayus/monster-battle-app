/**
 * Battles: reading one back out of its row, and the two things a player can
 * ask for — to begin one, and to play a turn.
 *
 * The browser decides one thing in a battle: which move to use. Who the enemy
 * is, how much damage a hit does and who won are all decided here, with the
 * rules in `@mba/core` and random numbers this process draws. The state lives
 * in the database between requests, and the browser is never asked for it
 * back.
 *
 * What a battle leaves behind is decided here as well. The turn that ends a
 * battle also says what the monster earned and what it lost, and where a
 * player who lost is put — as part of the same list of changes as the
 * battle's own last state, which `perform` writes together or not at all
 * (runtime.ts). There is no second request that collects a reward, so there
 * is nothing to collect twice and nothing left uncollected.
 */

import { and, eq } from "drizzle-orm";

import {
  combatantOf,
  err,
  hasWildMonsters,
  ok,
  pickWeighted,
  playTurn,
  settle,
  startBattle,
  tileAt,
  viewBattle,
  wildCombatant,
} from "@mba/core";
import type {
  BattleError,
  BattleState,
  BattleView,
  Combatant,
  Result,
  TurnOutcome,
} from "@mba/core";
import { battles, ownedMonsters } from "@mba/db";
import type { BattleRow, Read } from "@mba/db";

import type { UserId } from "./auth.js";
import type { Change } from "./changes.js";
import { findMap } from "./maps.js";
import { encountersOn, leadMonsterOf } from "./monsters.js";
import { unchanged } from "./runtime.js";
import type { Decision, World } from "./runtime.js";
import { loadSave, startingPoint } from "./saves.js";

/** A battle, but only if it is this user's. Someone else's does not exist. */
export function findBattle(read: Read, userId: UserId, id: string): BattleRow | undefined {
  return read
    .select()
    .from(battles)
    .where(and(eq(battles.id, id), eq(battles.userId, userId)))
    .get();
}

/**
 * The battle a monster is in the middle of, if it is in one. There is at most
 * one: the table has a unique index that says so (packages/db/src/schema.ts).
 */
export function ongoingBattleOf(read: Read, monsterId: string): BattleRow | undefined {
  return read
    .select()
    .from(battles)
    .where(and(eq(battles.monsterId, monsterId), eq(battles.status, "ongoing")))
    .get();
}

/** A combatant as an older version of this code may have written it down. */
type StoredCombatant = Omit<Combatant, "level"> & { level?: number };

/**
 * The state stored in a battle row.
 *
 * The row holds JSON, and JSON keeps the shape of the code that wrote it. A
 * column added later can be given a default for the rows already there; a
 * field added later inside a JSON document cannot. So the one thing that was
 * added — a combatant's level — is filled in here, where a battle is read.
 * Before levels existed, every monster fought with its species' own numbers,
 * which is what level 1 means: this is not a guess.
 *
 * What comes back is a battle at whatever stage it was left in. Anyone who
 * needs it to be at a particular one has to look at `status` first.
 */
export function stateOf(row: Pick<BattleRow, "state">): BattleState {
  const stored = JSON.parse(row.state) as Omit<BattleState, "player" | "enemy"> & {
    player: StoredCombatant;
    enemy: StoredCombatant;
  };
  const withLevel = (combatant: StoredCombatant): Combatant => ({
    ...combatant,
    level: combatant.level ?? 1,
  });
  return { ...stored, player: withLevel(stored.player), enemy: withLevel(stored.enemy) };
}

// ---------------------------------------------------------------------------
// Beginning a battle
// ---------------------------------------------------------------------------

export type BeginError =
  | { kind: "no_start_map" }
  /** The player is not standing in grass, or nothing lives in the grass of this map. */
  | { kind: "no_encounters_here" }
  | { kind: "no_monster" };

export interface Begun {
  battle: BattleView;
  /** False when this is a battle that was already going on, handed back. */
  isNew: boolean;
}

/**
 * Begins a battle where the player is standing — or hands back the one that
 * is not over yet.
 *
 * Nothing about it comes from the request. Where the player is comes from the
 * server's own record: a battle starts on the tile the last save put them on.
 */
export function beginBattle(
  { read, roll, newId }: World,
  userId: UserId,
): Result<Decision<Begun>, BeginError> {
  const save = loadSave(read, userId);
  const map = save === undefined ? undefined : findMap(read, save.mapId);
  if (save === undefined || map === undefined) return err({ kind: "no_start_map" });

  const tile = tileAt(map, save.position);
  if (tile === undefined || !hasWildMonsters(tile)) return err({ kind: "no_encounters_here" });

  const mine = leadMonsterOf(read, userId);
  if (mine === undefined) return err({ kind: "no_monster" });

  // One battle at a time. The monster's health carries over from battle to
  // battle, so a second one started beside the first would begin from the
  // health the first has not finished taking. A battle that is not over is
  // therefore the one the player is given: no roll is drawn, and there is
  // nothing to write. Leaving the screen halfway does not get anyone out of a
  // fight.
  const unfinished = ongoingBattleOf(read, mine.id);
  if (unfinished !== undefined) {
    return ok(unchanged({ battle: viewBattle(unfinished.id, stateOf(unfinished)), isNew: false }));
  }

  // The roll is drawn here and handed to the rule that uses it.
  const wild = pickWeighted(encountersOn(read, map.id), roll());
  if (wild === undefined) return err({ kind: "no_encounters_here" });

  // The player's monster goes in as it is now: grown to its level, with the
  // health it has left. Which monster this is is written on the battle, so
  // that the end of the battle knows whose numbers to change.
  const state = startBattle(combatantOf(mine), wildCombatant(wild));
  const id = newId();
  return ok({
    answer: { battle: viewBattle(id, state), isNew: true },
    changes: [{ kind: "battle_begun", id, userId, monsterId: mine.id, state }],
  });
}

// ---------------------------------------------------------------------------
// Playing a turn
// ---------------------------------------------------------------------------

/** A turn is a move id and a number. Nothing else in a request is looked at. */
export interface TurnInput {
  moveId: string;
  /** Which turn this move is for: the turn count the client was last shown. */
  turn: number;
}

export type TurnError =
  | { kind: "not_found" }
  /** This move was for a turn that has already been played. `turn` is the one the battle is on. */
  | { kind: "stale_turn"; turn: number }
  | { kind: "battle_over" }
  | BattleError;

/**
 * Plays one turn, and — if it was the last — says what the battle leaves
 * behind.
 *
 * Everything this turn changes comes back as one list: the battle's new
 * state, the monster's numbers, where a player who lost now is. A battle that
 * reads "won" beside a monster that was never paid, or a monster paid for a
 * battle still marked as going on, would each be a state nobody can put right
 * afterwards. As one list they are written together or not at all, and if not
 * at all the turn has not been played and can be sent again.
 */
export function takeTurn(
  { read, roll }: Pick<World, "read" | "roll">,
  userId: UserId,
  battleId: string,
  input: TurnInput,
): Result<Decision<TurnOutcome>, TurnError> {
  const row = findBattle(read, userId, battleId);
  if (row === undefined) return err({ kind: "not_found" });

  const state = stateOf(row);
  if (input.turn !== state.turn) return err({ kind: "stale_turn", turn: state.turn });

  // The one look at the stage. Past this line the compiler knows the battle
  // is still going on, which is what `playTurn` asks for.
  if (state.status !== "ongoing") return err({ kind: "battle_over" });

  const played = playTurn(state, input.moveId, {
    playerVariance: roll(),
    enemyMove: roll(),
    enemyVariance: roll(),
  });
  if (!played.ok) return played;

  const next = played.value.state;
  const events = [...played.value.events];
  const changes: Change[] = [{ kind: "battle_advanced", id: row.id, state: next }];

  // A battle from before monsters kept anything has no monster written on it,
  // and ends the way it began: nothing is carried out of it.
  const { monsterId } = row;
  if (next.status !== "ongoing" && monsterId !== null) {
    const fighter = read
      .select({ exp: ownedMonsters.exp })
      .from(ownedMonsters)
      .where(eq(ownedMonsters.id, monsterId))
      .get();
    if (fighter !== undefined) {
      const settled = settle(fighter, next);
      changes.push({
        kind: "monster_settled",
        id: monsterId,
        exp: settled.exp,
        damage: settled.damage,
      });
      events.push(...settled.events);

      // Losing costs the player where they had got to. Like every other
      // change of position that matters, it is the server that makes it; the
      // battle screen is only told the battle was lost.
      const home = next.status === "lost" ? startingPoint(read) : undefined;
      if (home !== undefined) changes.push({ kind: "player_placed", userId, at: home });
    }
  }

  return ok({ answer: { battle: viewBattle(row.id, next), events }, changes });
}
