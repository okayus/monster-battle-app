/**
 * A battle as the screen follows it: what it was last told, what it has said
 * so far, and whether a move is on its way.
 *
 * Pure, like the other `model.ts` files: the screen holds one `Fight`, feeds
 * `fight` what happens, and draws what comes back. Nothing here sends a
 * request.
 *
 * And nothing here judges a battle. There is no damage formula on this side,
 * no check for "has someone fainted" and no sum of experience. Every number
 * in a `Fight` is one the server sent; this file only keeps them in order.
 */

import type { BattleView, Side, TurnOutcome } from "@mba/core";

import type { ApiError } from "../api.js";
import { describeEvent } from "./log.js";

export interface Fight {
  /** The battle as the server last described it. */
  battle: BattleView;
  /** This visit's turns, as text. Not stored anywhere: a reload starts it empty. */
  log: readonly string[];
  /** A move has been sent and not answered yet. */
  waiting: boolean;
  /** Why the last move was not played. It stays until another move is sent. */
  refused: ApiError | null;
}

/** A battle that has just been opened: nothing said yet, nothing on its way. */
export function opened(battle: BattleView): Fight {
  return { battle, log: [], waiting: false, refused: null };
}

export type FightEvent =
  | { kind: "move_sent" }
  /** The server played the turn. */
  | { kind: "turn_played"; outcome: TurnOutcome }
  | { kind: "turn_refused"; error: ApiError }
  /** The battle, fetched again after the server said this screen was behind. */
  | { kind: "caught_up"; battle: BattleView };

/**
 * What to call each side in the log.
 *
 * A wild monster can be the same species as the player's, and then the log
 * would read as one monster hitting itself.
 */
export function namesOf(battle: BattleView): Record<Side, string> {
  return { player: battle.player.name, enemy: `やせいの ${battle.enemy.name}` };
}

export function fight(state: Fight, event: FightEvent): Fight {
  switch (event.kind) {
    case "move_sent":
      return { ...state, waiting: true, refused: null };
    case "turn_played": {
      const names = namesOf(state.battle);
      const said = event.outcome.events.map((happened) => describeEvent(happened, names));
      return {
        battle: event.outcome.battle,
        // Lines are only ever added at the end.
        log: [...state.log, ...said],
        waiting: false,
        refused: null,
      };
    }
    case "turn_refused":
      return { ...state, waiting: false, refused: event.error };
    case "caught_up":
      // Only the battle. The log is what this screen saw happen, and the
      // turns played somewhere else are not among that.
      return { ...state, battle: event.battle };
  }
}

/**
 * Whether a refusal means this screen is behind — another tab played, or a
 * request went through twice. Then the server's version is the truth, and
 * the thing to do is to fetch it.
 */
export function isBehind(error: ApiError): boolean {
  return error.kind === "stale_turn";
}

/** Whether there are moves to choose from: the battle is still going on. */
export function isGoingOn(state: Fight): boolean {
  return state.battle.status === "ongoing";
}
