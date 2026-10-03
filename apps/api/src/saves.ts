/**
 * Where a player is, as far as the server is concerned.
 *
 * Anything that needs the player's position asks here — the save route to
 * answer the browser, the battle route to see what the player is standing on —
 * so "no save yet" and "a save that no longer makes sense" are decided once.
 */

import { eq } from "drizzle-orm";

import { canStandOn } from "@mba/core";
import type { SaveData } from "@mba/core";
import { saves } from "@mba/db";
import type { Db, DbOrTx } from "@mba/db";

import { START_MAP_ID, findMap } from "./maps.js";

/**
 * Where a new game starts — and where a player is put back to: one with a
 * save that no longer makes sense, and one whose monster has just lost a
 * battle. Undefined only if there is no starter map at all.
 */
export function startingPoint(db: Db): SaveData | undefined {
  const start = findMap(db, START_MAP_ID);
  return start === undefined ? undefined : { mapId: start.id, position: start.spawn };
}

/**
 * Writes down where a player is. One row per player, so this replaces.
 *
 * Whether the player may be there is not asked here. Each caller has its own
 * reason to believe so: the save route checked the walk, the travel route read
 * the exit, and a lost battle sends the player to the starting point.
 */
export function storeSave(conn: DbOrTx, userId: string, save: SaveData, now: Date): void {
  const values = { mapId: save.mapId, x: save.position.x, y: save.position.y, updatedAt: now };
  conn
    .insert(saves)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: saves.userId, set: values })
    .run();
}

/**
 * The player's position, or the starting point if they have none worth
 * keeping. Undefined only if there is no starter map at all.
 */
export function loadSave(db: Db, userId: string): SaveData | undefined {
  const row = db.select().from(saves).where(eq(saves.userId, userId)).get();

  if (row !== undefined) {
    const map = findMap(db, row.mapId);
    const position = { x: row.x, y: row.y };
    // A save can outlive what it points at: the map may have been redrawn
    // since, leaving a tree where the player was standing. That is decided
    // here, once, so nothing downstream has to handle "a position I cannot
    // be at".
    if (map !== undefined && canStandOn(map, position)) return { mapId: row.mapId, position };
  }

  // No save, or one that no longer makes sense: a new game.
  return startingPoint(db);
}
