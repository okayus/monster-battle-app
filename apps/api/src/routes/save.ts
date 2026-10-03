/**
 * Save routes — where the player is.
 *
 *   GET /api/save   the saved position, or the starting point if there is none
 *   PUT /api/save   store a position
 *
 * There is no id in either path. Whose save it is comes from `getUserId(c)`,
 * never from the request (docs/04-api-design.md §認証と認可).
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { canStandOn } from "@mba/core";
import type { SaveData } from "@mba/core";
import { saves } from "@mba/db";
import type { Db } from "@mba/db";

import { getUserId } from "../auth.js";
import { jsonBodyLimit, parseShape, readJson } from "../http.js";
import { START_MAP_ID, findMap } from "../maps.js";

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
    const row = db
      .select()
      .from(saves)
      .where(eq(saves.userId, getUserId(c)))
      .get();

    if (row !== undefined) {
      const map = findMap(db, row.mapId);
      const position = { x: row.x, y: row.y };
      // A save can outlive what it points at: the map may have been redrawn
      // since, leaving a tree where the player was standing. That is decided
      // here, once, so no screen has to handle "a position I cannot be at".
      if (map !== undefined && canStandOn(map, position)) {
        return c.json({ mapId: row.mapId, position } satisfies SaveData);
      }
    }

    // No save, or one that no longer makes sense: a new game.
    const start = findMap(db, START_MAP_ID);
    if (start === undefined) return c.json({ error: { kind: "no_start_map" } }, 500);
    return c.json({ mapId: start.id, position: start.spawn } satisfies SaveData);
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

    // The browser moves the player with the same `step()` the server could
    // run, but its word is not taken for it: a position is stored only if it
    // is somewhere a player can actually be. What is *not* checked is how the
    // player got there — see docs/04-api-design.md §実装.
    if (!canStandOn(map, position)) {
      return c.json({ error: { kind: "cannot_stand", mapId, position } }, 400);
    }

    const values = { mapId, x: position.x, y: position.y, updatedAt: new Date() };
    db.insert(saves)
      .values({ userId: getUserId(c), ...values })
      .onConflictDoUpdate({ target: saves.userId, set: values })
      .run();

    return c.json({ mapId, position } satisfies SaveData);
  });

  return routes;
}
