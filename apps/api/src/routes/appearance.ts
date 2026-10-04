/**
 * Appearance routes — what the player looks like.
 *
 *   GET /api/appearance   the recipe, or the default look if none was chosen
 *   PUT /api/appearance   replace the recipe
 *
 * As with /api/save there is no id in either path: whose look it is comes
 * from `getUserId(c)`, never from the request.
 *
 * And as with skins there is no zod schema. `parseAppearance` is the one
 * description of what a recipe may contain (docs/02-sprite-format.md); a
 * second one here would drift from it. The body goes to the decision as it
 * was read, and the decision's first act is to parse it (appearance.ts).
 */

import { Hono } from "hono";

import { chooseLook, loadAppearance } from "../appearance.js";
import { getUserId } from "../auth.js";
import { jsonBodyLimit, readJson } from "../http.js";
import { refuse } from "../refusals.js";
import type { Runtime } from "../runtime.js";

/** A recipe is a handful of ids and colours. The largest valid one is under 3 KB. */
const MAX_APPEARANCE_BYTES = 4 * 1024;

export function appearanceRoutes({ read, perform }: Runtime) {
  const routes = new Hono();

  routes.get("/", (c) => {
    // Always an answer: a player who has not chosen is wearing the default
    // skin (see appearance.ts), so no screen has to handle "no look".
    return c.json(loadAppearance(read, getUserId(c)));
  });

  routes.put("/", jsonBodyLimit(MAX_APPEARANCE_BYTES), async (c) => {
    const body = await readJson(c);
    if (!body.ok) return refuse(c, body.error);

    const chosen = perform((world) => chooseLook(world, getUserId(c), body.value));
    return chosen.ok ? c.json(chosen.value) : refuse(c, chosen.error);
  });

  return routes;
}
