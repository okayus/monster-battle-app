/**
 * Skin routes — the first slice that goes all the way through
 * (docs/05-roadmap.md, Step 2).
 *
 *   GET  /api/skins             every skin by name, for choosing what to wear
 *   POST /api/skins             the editor's output: validated, then stored twice
 *   GET  /api/skins/:id         the render-ready form, exactly as stored
 *   GET  /api/skins/:id/source  the editable form, for opening a skin in the editor
 *
 * There is no zod schema here, on purpose. `parseSkin` is the single trust
 * boundary for skins (docs/02-sprite-format.md), and a second description of
 * the same shape would drift from it.
 */

import { Hono } from "hono";

import type { WearableSkin } from "@mba/core";
import { SKIN_SPEC } from "@mba/sprite";

import { getUserId } from "../auth.js";
import { jsonBodyLimit, readJson } from "../http.js";
import { refuse } from "../refusals.js";
import type { Runtime } from "../runtime.js";
import { drawSkin, listSkins, storedDrawing, storedSource } from "../skins.js";

export function skinRoutes({ read, perform }: Runtime) {
  const routes = new Hono();

  routes.get("/", (c) => {
    const userId = getUserId(c);
    // Names only. A drawing is asked for by id, by whoever wants to show it.
    // And whose a skin is leaves the server as "yours" or "not yours": the
    // list is the same for everyone, but nobody is handed another user's id.
    //
    // A retired skin is not on this list — not even for whoever drew it. That
    // is what retiring means on this side of the API: no longer offered.
    const wearable: WearableSkin[] = listSkins(read)
      .filter((skin) => !skin.retired)
      .map((skin) => ({ id: skin.id, name: skin.name, mine: skin.ownerId === userId }));
    return c.json(wearable);
  });

  routes.post(
    "/",
    // Two size limits, two different jobs. This one stops the server from
    // buffering an arbitrarily large request, and it runs before a single byte
    // is parsed. `parseSkin` has its own cap (same number) on what may be
    // *stored*; that one cannot protect the process, because by the time it
    // runs the body is already in memory.
    jsonBodyLimit(SKIN_SPEC.maxBytes),
    async (c) => {
      const body = await readJson(c);
      if (!body.ok) return refuse(c, body.error);

      const drawn = perform((world) => drawSkin(world, getUserId(c), body.value));
      if (!drawn.ok) return refuse(c, drawn.error);

      const { id } = drawn.value;
      return c.json({ id }, 201, { Location: `/api/skins/${id}` });
    },
  );

  // The stored text goes out as it is, already JSON (see skins.ts).
  routes.get("/:id", (c) => {
    const text = storedDrawing(read, c.req.param("id"));
    if (text === undefined) return refuse(c, { kind: "not_found" });
    return c.body(text, 200, { "Content-Type": "application/json" });
  });

  routes.get("/:id/source", (c) => {
    const text = storedSource(read, c.req.param("id"));
    if (text === undefined) return refuse(c, { kind: "not_found" });
    return c.body(text, 200, { "Content-Type": "application/json" });
  });

  return routes;
}
