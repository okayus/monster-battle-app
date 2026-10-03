/**
 * Skin routes — the first slice that goes all the way through
 * (docs/05-roadmap.md, Step 2).
 *
 *   POST /api/skins      the editor's output: validated, then stored twice
 *   GET  /api/skins/:id  the render-ready form, exactly as stored
 *
 * There is no zod schema here, on purpose. `parseSkin` is the single trust
 * boundary for skins (docs/02-sprite-format.md), and a second description of
 * the same shape would drift from it.
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { skins } from "@mba/db";
import type { Db } from "@mba/db";
import { SKIN_SPEC, parseSkin } from "@mba/sprite";

import { getUserId } from "../auth.js";
import { jsonBodyLimit, readJson } from "../http.js";
import { skinRow } from "../skins.js";

export function skinRoutes(db: Db) {
  const routes = new Hono();

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
      if (!body.ok) return c.json({ error: body.error }, 400);

      const parsed = parseSkin(body.value);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);

      // From here on only `skin` is used — never `body.value`. What goes into
      // the database is the value parseSkin rebuilt, so nothing the validator
      // did not look at can reach storage.
      const skin = parsed.value;
      const id = crypto.randomUUID();

      // The owner is decided by the server. The body has no say in it.
      db.insert(skins)
        .values(skinRow(id, getUserId(c), skin, new Date()))
        .run();

      return c.json({ id }, 201, { Location: `/api/skins/${id}` });
    },
  );

  routes.get("/:id", (c) => {
    const row = db
      .select({ renderable: skins.renderable })
      .from(skins)
      .where(eq(skins.id, c.req.param("id")))
      .get();
    if (row === undefined) return c.json({ error: { kind: "not_found" } }, 404);

    // The stored text goes out as it is: no parse, no re-serialize. This is
    // the payoff of deriving the render-ready form at write time — the read
    // path is one indexed lookup and a copy.
    return c.body(row.renderable, 200, { "Content-Type": "application/json" });
  });

  return routes;
}
