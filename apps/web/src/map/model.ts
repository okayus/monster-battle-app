/**
 * Walking on a map: everything the map screen knows, and every way it changes,
 * as pure functions.
 *
 * The screen holds one `Walk` and feeds it what happens — a key was pressed,
 * a save came back, the server refused an exit. `walk` answers with the next
 * `Walk`. Nothing here fetches, saves or draws; the screen does those, and
 * decides when from the questions at the bottom of this file (`wantsExit`,
 * `canSearch`). The same split as the editor's and the wardrobe's `model.ts`,
 * for the same reason: when to go through an exit is a rule, and a rule can be
 * tested without a browser.
 *
 * None of it is a defence. The server checks every position it is sent and
 * decides by itself which exit a player is on (docs/04-api-design.md). These
 * rules only keep the screen from asking for what it could have known would be
 * refused — or, worse, from asking twice.
 *
 * Positions are compared by identity, on purpose. `step` hands back the very
 * object it was given when the way is blocked, and the server's answers are
 * kept as the objects they arrived in, so "has anything moved" and "is this
 * the position the server has" are each a single `===`.
 */

import { exitAt, hasWildMonsters, step, tileAt } from "@mba/core";
import type { Direction, GameMap, Position, TileKind } from "@mba/core";

import type { ApiError } from "../api.js";
import type { SaveStatus } from "../saver.js";

/** Something the screen asks the server for, one at a time. */
export type Attempt = { kind: "idle" } | { kind: "asking" } | { kind: "failed"; error: ApiError };

export interface Walk {
  map: GameMap;
  /** Where the server had the player when this map was loaded. */
  start: Position;
  /** Where the player is on screen. */
  position: Position;
  /**
   * The position the server is known to have: `start`, and after that each
   * one a save came back for.
   */
  confirmed: Position;
  /** What the last save said, or null while there has been nothing to save. */
  saving: SaveStatus<ApiError> | null;
  /** Looking for a wild monster in the grass. */
  search: Attempt;
  /** Going through the exit the player stepped onto. */
  travel: Attempt;
  /**
   * The step onto an exit that the server has already been asked about. One
   * step is asked about once: going through an exit is not safe to repeat,
   * because asked twice the server would take the player through whatever
   * exit they arrived on.
   */
  asked: Position | null;
}

/** A player who has just arrived: on the map, where the server put them, with nothing going on. */
export function arrived(map: GameMap, start: Position): Walk {
  return {
    map,
    start,
    position: start,
    confirmed: start,
    saving: null,
    search: { kind: "idle" },
    travel: { kind: "idle" },
    asked: null,
  };
}

export type WalkEvent =
  /** An arrow key, WASD, or one of the buttons. */
  | { kind: "stepped"; dir: Direction }
  /** The saver reporting on the request it has out. */
  | { kind: "save_reported"; status: SaveStatus<ApiError> }
  /** The server stored this position. */
  | { kind: "position_confirmed"; at: Position }
  | { kind: "search_started" }
  | { kind: "search_failed"; error: ApiError }
  | { kind: "travel_started" }
  | { kind: "travel_failed"; error: ApiError };

/**
 * The next state. When nothing changes it is the state it was given, the very
 * object — so a key pressed against a wall costs no render, and no save.
 */
export function walk(state: Walk, event: WalkEvent): Walk {
  switch (event.kind) {
    case "stepped": {
      // While the server is taking the player through an exit, they stay put.
      // A step taken now would be a save on a map they are about to have left.
      if (leaving(state)) return state;
      const position = step(state.position, event.dir, state.map);
      return position === state.position ? state : { ...state, position };
    }
    case "save_reported":
      return { ...state, saving: event.status };
    case "position_confirmed":
      return { ...state, confirmed: event.at };
    case "search_started":
      return { ...state, search: { kind: "asking" } };
    case "search_failed":
      return { ...state, search: { kind: "failed", error: event.error } };
    case "travel_started":
      return { ...state, travel: { kind: "asking" }, asked: state.position };
    case "travel_failed":
      return { ...state, travel: { kind: "failed", error: event.error } };
  }
}

// ---------------------------------------------------------------------------
// What follows from a state. None of these is stored: each is worked out from
// the state whenever it is asked for, so none of them can disagree with it.
// ---------------------------------------------------------------------------

/** Whether there is a position that has not been sent to be saved since arriving. */
export function hasMoved(state: Walk): boolean {
  // `start` came from the server, so there is nothing to save until the
  // player has actually moved. Walking back onto the same tile is a move: it
  // is a different object, and the server has to hear about it.
  return state.position !== state.start;
}

/**
 * Whether the server has the position that is on screen.
 *
 * The server starts a battle — and takes a player through an exit — from the
 * tile it has stored, not from the one this screen is showing. So both wait
 * until the two agree.
 *
 * Asked of the position itself, and not read off the save status. The status
 * is one step behind: for an instant after stepping it still says "saved",
 * about the step before.
 */
export function isStored(state: Walk): boolean {
  return state.confirmed === state.position;
}

/** The kind of tile the player is standing on. */
export function tileUnder(state: Walk): TileKind | undefined {
  return tileAt(state.map, state.position);
}

export function inGrass(state: Walk): boolean {
  const here = tileUnder(state);
  return here !== undefined && hasWildMonsters(here);
}

/** Whether the grass under the player can be searched right now. */
export function canSearch(state: Walk): boolean {
  return inGrass(state) && isStored(state) && state.search.kind !== "asking";
}

export function onExit(state: Walk): boolean {
  return exitAt(state.map, state.position) !== undefined;
}

/** Whether the server is taking the player through an exit at this moment. */
export function leaving(state: Walk): boolean {
  return state.travel.kind === "asking";
}

/**
 * Whether it is time to ask the server to take the player through an exit.
 *
 * An exit is taken by stepping onto it. Arriving on one — the far end of a
 * door that works both ways — is not stepping onto it: the position is still
 * the one the server's answer was loaded into. And the server goes by the
 * position it has stored, so the step has to have reached it first: the same
 * wait as before a battle.
 *
 * Each step is asked about once. A refusal is not asked again; stepping off
 * and on again is how to try again.
 */
export function wantsExit(state: Walk): boolean {
  return onExit(state) && hasMoved(state) && isStored(state) && state.asked !== state.position;
}

/** The refusal to show: only while still standing on the exit that was refused. */
export function exitRefused(state: Walk): ApiError | null {
  return state.travel.kind === "failed" && onExit(state) ? state.travel.error : null;
}
