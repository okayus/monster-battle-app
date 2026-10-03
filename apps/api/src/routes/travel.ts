/**
 * The travel route — the only way from one map to another.
 *
 *   POST /api/travel   go through the exit the player is standing on
 *
 * There is no body. Which exit, and where it leads, are both read from what
 * the server already has: the position the last save stored, and the exits of
 * the map that position is on. The browser can say "go through", and nothing
 * else — the same shape as starting a battle (routes/battles.ts).
 *
 * This is where the line about positions was redrawn (docs/04-api-design.md).
 * Inside a map, a save is still stored if the tile can be stood on, with no
 * question about how the player got there. Between maps there is now a
 * question, and this route is the one that asks it.
 */

import { Hono } from "hono";

import { canStandOn, exitAt } from "@mba/core";
import type { SaveData } from "@mba/core";
import type { Db } from "@mba/db";

import { getUserId } from "../auth.js";
import { findMap } from "../maps.js";
import { loadSave, storeSave } from "../saves.js";

export function travelRoutes(db: Db) {
  const routes = new Hono();

  routes.post("/", (c) => {
    const userId = getUserId(c);

    const here = loadSave(db, userId);
    const map = here === undefined ? undefined : findMap(db, here.mapId);
    if (here === undefined || map === undefined) {
      return c.json({ error: { kind: "no_start_map" } }, 500);
    }

    const exit = exitAt(map, here.position);
    if (exit === undefined) return c.json({ error: { kind: "no_exit_here" } }, 400);

    // Both of these were checked when the exit was saved, and are kept true
    // by the admin API afterwards: the far map cannot be retired while an
    // exit leads to it, or redrawn so that the exit lands on a tree. If either
    // fails here, the master data is inconsistent, and that is a bug to hear
    // about, not a state to walk a player into.
    const far = findMap(db, exit.to.mapId);
    if (far === undefined || !canStandOn(far, exit.to.position)) {
      return c.json({ error: { kind: "broken_exit" } }, 500);
    }

    const arrived: SaveData = { mapId: far.id, position: exit.to.position };
    storeSave(db, userId, arrived, new Date());
    return c.json(arrived);
  });

  return routes;
}
