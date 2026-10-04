/**
 * Save routes — where the player is.
 *
 *   GET /api/save   the saved position, or the starting point if there is none
 *   PUT /api/save   store a position — one the player could have walked to
 *
 * There is no id in either path. Whose save it is comes from `getUserId(c)`,
 * never from the request (docs/04-api-design.md §認証と認可).
 *
 * What is here is the HTTP part only: read the body, hand it over, say what
 * came back. Whether a position may be stored is decided in saves.ts.
 */

import { Hono } from "hono";
import { z } from "zod";

import type { SaveData } from "@mba/core";

import { getUserId } from "../auth.js";
import { jsonBodyLimit, readBody } from "../http.js";
import { refuse } from "../refusals.js";
import type { Runtime } from "../runtime.js";
import { loadSave, savePosition } from "../saves.js";

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

export function saveRoutes({ read, perform }: Runtime) {
  const routes = new Hono();

  routes.get("/", (c) => {
    // Always an answer for a known user: with no save, or one that no longer
    // makes sense, `loadSave` gives the starting point (see saves.ts). And
    // only an answer: this route was given nothing to write a row with.
    const save = loadSave(read, getUserId(c));
    if (save === undefined) return refuse(c, { kind: "no_start_map" });
    return c.json(save);
  });

  routes.put("/", jsonBodyLimit(MAX_SAVE_BYTES), async (c) => {
    // Shape first (zod), then the game's own rules (saves.ts, with core).
    const body = await readBody(c, saveSchema);
    if (!body.ok) return refuse(c, body.error);

    const saved = perform((world) => savePosition(world, getUserId(c), body.value));
    return saved.ok ? c.json(saved.value) : refuse(c, saved.error);
  });

  return routes;
}
