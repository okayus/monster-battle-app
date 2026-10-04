/**
 * Everything a request can change, and the one function that changes it.
 *
 * A decision does not write (see runtime.ts). It returns a list of these —
 * what should be different afterwards, as plain values — and `commit` is what
 * turns the list into SQL. So there is one place in the API where a request
 * reaches `insert` or `update`, and it is this file: a route is not handed
 * anything it could write with, and a decision has nothing to write to.
 *
 * Being values, the changes can be looked at before they happen. A test can
 * ask a decision what it would do and compare the answer with `toEqual`, and
 * a decision that finds everything already as it should be says so by
 * returning none.
 *
 * Seeding at boot is not a request and does not come through here: "put it in
 * if it is missing" is a different rule from any of these (seed.ts).
 */

import type { SaveData } from "@mba/core";
import { saves } from "@mba/db";
import type { Tx } from "@mba/db";

import type { UserId } from "./auth.js";

export type Change =
  /**
   * The player is somewhere else now. Whether they may be there is not asked
   * here: whoever decided this had its own reason to believe so — a save
   * checked the walk, an exit was read off the map, a lost battle sends the
   * player to the starting point.
   */
  { kind: "player_placed"; userId: UserId; at: SaveData };

/** One row per player, so this replaces. */
function placePlayer(tx: Tx, userId: UserId, at: SaveData, now: Date): void {
  const values = { mapId: at.mapId, x: at.position.x, y: at.position.y, updatedAt: now };
  tx.insert(saves)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: saves.userId, set: values })
    .run();
}

function apply(tx: Tx, change: Change, now: Date): void {
  switch (change.kind) {
    case "player_placed":
      return placePlayer(tx, change.userId, change.at, now);
    default:
      // Every kind is written above. A kind added to `Change` and not given
      // its SQL stops compiling on this line.
      return change.kind satisfies never;
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
