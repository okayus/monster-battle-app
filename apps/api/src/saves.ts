/**
 * Where a player is, as far as the server is concerned.
 *
 * Anything that needs the player's position asks here — the save route to
 * answer the browser, the battle route to see what the player is standing on —
 * so "no save yet" and "a save that no longer makes sense" are decided once.
 *
 * The two ways a player's position changes at their own request are decided
 * here as well: storing where they walked to, and going through an exit. Both
 * are decisions in the sense of runtime.ts. They read, and they return what
 * should be written; neither of them writes.
 */

import { eq } from "drizzle-orm";

import { canStandOn, canWalkTo, err, exitAt, ok } from "@mba/core";
import type { Position, Result, SaveData } from "@mba/core";
import { saves } from "@mba/db";
import type { Read } from "@mba/db";

import type { UserId } from "./auth.js";
import { START_MAP_ID, findMap } from "./maps.js";
import type { Decision, World } from "./runtime.js";

/**
 * Where a new game starts — and where a player is put back to: one with a
 * save that no longer makes sense, and one whose monster has just lost a
 * battle. Undefined only if there is no starter map at all.
 */
export function startingPoint(read: Read): SaveData | undefined {
  const start = findMap(read, START_MAP_ID);
  return start === undefined ? undefined : { mapId: start.id, position: start.spawn };
}

/**
 * The player's position, or the starting point if they have none worth
 * keeping. Undefined only if there is no starter map at all.
 */
export function loadSave(read: Read, userId: UserId): SaveData | undefined {
  const row = read.select().from(saves).where(eq(saves.userId, userId)).get();

  if (row !== undefined) {
    const map = findMap(read, row.mapId);
    const position = { x: row.x, y: row.y };
    // A save can outlive what it points at: the map may have been redrawn
    // since, leaving a tree where the player was standing. That is decided
    // here, once, so nothing downstream has to handle "a position I cannot
    // be at".
    if (map !== undefined && canStandOn(map, position)) return { mapId: row.mapId, position };
  }

  // No save, or one that no longer makes sense: a new game.
  return startingPoint(read);
}

// ---------------------------------------------------------------------------
// Storing a position
// ---------------------------------------------------------------------------

export type SaveError =
  | { kind: "unknown_map"; mapId: string }
  /** There is no starter map, so there is nowhere the player could be. A fault here, not in the request. */
  | { kind: "no_start_map" }
  | { kind: "wrong_map"; mapId: string; current: string }
  | { kind: "cannot_stand"; mapId: string; position: Position }
  | { kind: "unreachable"; mapId: string; position: Position };

/**
 * Stores where the player says they are — if it is somewhere they could have
 * walked to.
 *
 * The browser moves the player with the same `step()` the server could run,
 * but its word is not taken for it. `wanted` has the shape of a save and
 * nothing more; whether it is a place this player can be is decided here.
 */
export function savePosition(
  { read }: Pick<World, "read">,
  userId: UserId,
  wanted: SaveData,
): Result<Decision<SaveData>, SaveError> {
  const { mapId, position } = wanted;

  const map = findMap(read, mapId);
  if (map === undefined) return err({ kind: "unknown_map", mapId });

  // A save cannot change which map the player is on. That takes an exit, and
  // going through one is `takeExit` below: there the destination comes from
  // the server's own record, not from a request. "The map the player is on"
  // is whatever `loadSave` says — the starting map for someone who has never
  // saved, or whose map has been retired.
  const current = loadSave(read, userId);
  if (current === undefined) return err({ kind: "no_start_map" });
  if (mapId !== current.mapId) return err({ kind: "wrong_map", mapId, current: current.mapId });

  // A position is stored only if it is somewhere a player can actually be.
  if (!canStandOn(map, position)) return err({ kind: "cannot_stand", mapId, position });

  // And only if the player could have walked there from where the server
  // last had them. A battle won is worth something, so where a player may
  // be is worth something too: grass behind a wall is out of reach of a
  // request, exactly as it is out of reach of the arrow keys.
  // Not checked: how many steps the walk takes, or how fast it was done —
  // see docs/04-api-design.md §実装.
  if (!canWalkTo(map, current.position, position)) {
    return err({ kind: "unreachable", mapId, position });
  }

  // Rebuilt from the two fields that were checked, not passed along.
  const stored: SaveData = { mapId, position };
  return ok({ answer: stored, changes: [{ kind: "player_placed", userId, at: stored }] });
}

// ---------------------------------------------------------------------------
// Going through an exit
// ---------------------------------------------------------------------------

export type TravelError =
  | { kind: "no_start_map" }
  | { kind: "no_exit_here" }
  /** The exit leads somewhere a player cannot stand. Master data is inconsistent: a fault here. */
  | { kind: "broken_exit" };

/**
 * Takes the player through the exit they are standing on — the only way from
 * one map to another.
 *
 * It takes no input but who is asking. Which exit, and where it leads, are
 * both read from what the server already has: the position the last save
 * stored, and the exits of the map that position is on. The browser can say
 * "go through", and nothing else — the same shape as starting a battle.
 */
export function takeExit(
  { read }: Pick<World, "read">,
  userId: UserId,
): Result<Decision<SaveData>, TravelError> {
  const here = loadSave(read, userId);
  const map = here === undefined ? undefined : findMap(read, here.mapId);
  if (here === undefined || map === undefined) return err({ kind: "no_start_map" });

  const exit = exitAt(map, here.position);
  if (exit === undefined) return err({ kind: "no_exit_here" });

  // Both of these were checked when the exit was saved, and are kept true
  // by the admin API afterwards: the far map cannot be retired while an
  // exit leads to it, or redrawn so that the exit lands on a tree. If either
  // fails here, the master data is inconsistent, and that is a bug to hear
  // about, not a state to walk a player into.
  const far = findMap(read, exit.to.mapId);
  if (far === undefined || !canStandOn(far, exit.to.position)) {
    return err({ kind: "broken_exit" });
  }

  const arrived: SaveData = { mapId: far.id, position: exit.to.position };
  return ok({ answer: arrived, changes: [{ kind: "player_placed", userId, at: arrived }] });
}
