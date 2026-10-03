/**
 * Battles, as they are stored: reading one back out of its row, and the one
 * question other parts of the API ask about them — is this monster in the
 * middle of one.
 */

import { and, eq } from "drizzle-orm";

import type { BattleState, Combatant } from "@mba/core";
import { battles } from "@mba/db";
import type { BattleRow, Db } from "@mba/db";

/**
 * The battle a monster is in the middle of, if it is in one. There is at most
 * one: the table has a unique index that says so (packages/db/src/schema.ts).
 */
export function ongoingBattleOf(db: Db, monsterId: string): BattleRow | undefined {
  return db
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
