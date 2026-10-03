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
 * second one here would drift from it.
 */

import { Hono } from "hono";

import type { Db } from "@mba/db";
import { coloursOf, composeAppearance, parseAppearance, skinsNamedBy } from "@mba/sprite";

import { loadAppearance, saveAppearance } from "../appearance.js";
import { getUserId } from "../auth.js";
import { jsonBodyLimit, readJson } from "../http.js";
import { renderablesOf } from "../skins.js";

/** A recipe is a handful of ids and colours. The largest valid one is under 3 KB. */
const MAX_APPEARANCE_BYTES = 4 * 1024;

export function appearanceRoutes(db: Db) {
  const routes = new Hono();

  routes.get("/", (c) => {
    // Always an answer: a player who has not chosen is wearing the default
    // skin (see appearance.ts), so no screen has to handle "no look".
    return c.json(loadAppearance(db, getUserId(c)));
  });

  routes.put("/", jsonBodyLimit(MAX_APPEARANCE_BYTES), async (c) => {
    const body = await readJson(c);
    if (!body.ok) return c.json({ error: body.error }, 400);

    // What a recipe may say at all: ids, slots and colours, in the patterns
    // that are safe to hand to CSS.
    const parsed = parseAppearance(body.value);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    // From here on only `appearance` is used — never `body.value`.
    const appearance = parsed.value;

    // What only the database can say: can the skins it names be worn? One
    // that has been retired is refused exactly like one that never existed.
    const named = skinsNamedBy(appearance);
    const skins = renderablesOf(db, named);
    for (const skinId of named) {
      if (!skins.has(skinId)) return c.json({ error: { kind: "unknown_skin", skinId } }, 400);
    }

    // And does the look have the colours the recipe changes? The look is put
    // together by the same function the browser draws it with, so "a colour
    // this look has" means the same thing on both sides.
    const look = composeAppearance(appearance, skins);
    const painted = new Set((look === undefined ? [] : coloursOf(look)).map((entry) => entry.id));
    for (const { id } of appearance.colours) {
      if (!painted.has(id)) return c.json({ error: { kind: "unknown_colour", id } }, 400);
    }

    saveAppearance(db, getUserId(c), appearance, new Date());
    return c.json(appearance);
  });

  return routes;
}
