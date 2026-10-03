/**
 * Save routes — where the player is.
 *
 *   GET /api/save   the saved position, or the starting point if there is none
 *   PUT /api/save   store a position — one the player could have walked to
 *
 * There is no id in either path. Whose save it is comes from `getUserId(c)`,
 * never from the request (docs/04-api-design.md §認証と認可).
 */

import { Hono } from "hono";
import { z } from "zod";

import { canStandOn, canWalkTo } from "@mba/core";
import type { SaveData } from "@mba/core";
import type { Db } from "@mba/db";

import { getUserId } from "../auth.js";
import { jsonBodyLimit, parseShape, readJson } from "../http.js";
import { findMap } from "../maps.js";
import { loadSave, storeSave } from "../saves.js";

/** A save is a few dozen bytes. Anything near this is not a save. */
const MAX_SAVE_BYTES = 1024;

/**
 * The shape of a save, and nothing more: integers, not "integers that are on
 * the map". Typed against `SaveData`, so the schema and the domain type cannot
 * drift apart without a compile error.
 */
const saveSchema: z.ZodType<SaveData> = z.object({
  mapId: z.string().min(1).max(64),
  position: z.object({ x: z.number().int(), y: z.number().int() }),
});

export function saveRoutes(db: Db) {
  const routes = new Hono();

  routes.get("/", (c) => {
    // Always an answer for a known user: with no save, or one that no longer
    // makes sense, `loadSave` gives the starting point (see saves.ts).
    const save = loadSave(db, getUserId(c));
    if (save === undefined) return c.json({ error: { kind: "no_start_map" } }, 500);
    return c.json(save);
  });

  routes.put("/", jsonBodyLimit(MAX_SAVE_BYTES), async (c) => {
    const body = await readJson(c);
    if (!body.ok) return c.json({ error: body.error }, 400);

    // Shape first (zod), then the game's own rule (core).
    const shape = parseShape(saveSchema, body.value);
    if (!shape.ok) return c.json({ error: shape.error }, 400);
    const { mapId, position } = shape.value;

    const map = findMap(db, mapId);
    if (map === undefined) return c.json({ error: { kind: "unknown_map", mapId } }, 400);

    // A save cannot change which map the player is on. That takes an exit, and
    // going through one is the travel route's job (routes/travel.ts): there
    // the destination comes from the server's own record, not from a request.
    // "The map the player is on" is whatever `loadSave` says — the starting
    // map for someone who has never saved, or whose map has been retired.
    const current = loadSave(db, getUserId(c));
    if (current === undefined) return c.json({ error: { kind: "no_start_map" } }, 500);
    if (mapId !== current.mapId) {
      return c.json({ error: { kind: "wrong_map", mapId, current: current.mapId } }, 400);
    }

    // The browser moves the player with the same `step()` the server could
    // run, but its word is not taken for it: a position is stored only if it
    // is somewhere a player can actually be.
    if (!canStandOn(map, position)) {
      return c.json({ error: { kind: "cannot_stand", mapId, position } }, 400);
    }

    // And only if the player could have walked there from where the server
    // last had them. A battle won is worth something, so where a player may
    // be is worth something too: grass behind a wall is out of reach of a
    // request, exactly as it is out of reach of the arrow keys.
    // Not checked: how many steps the walk takes, or how fast it was done —
    // see docs/04-api-design.md §実装.
    if (!canWalkTo(map, current.position, position)) {
      return c.json({ error: { kind: "unreachable", mapId, position } }, 400);
    }

    const stored: SaveData = { mapId, position };
    storeSave(db, getUserId(c), stored, new Date());
    return c.json(stored);
  });

  return routes;
}
