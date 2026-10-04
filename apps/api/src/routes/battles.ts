/**
 * Battle routes.
 *
 *   POST /api/battles            start a battle where the player is standing —
 *                                or go back to the one that is not over yet
 *   GET  /api/battles/:id        the battle as the screen needs it
 *   POST /api/battles/:id/turn   play one turn: the body names a move, nothing else
 *
 * What is here is the HTTP part only. Who the enemy is, what a turn does and
 * what a finished battle leaves behind are decided in battles.ts, with the
 * rules in `@mba/core`.
 */

import { Hono } from "hono";
import { z } from "zod";

import { viewBattle } from "@mba/core";

import { getUserId } from "../auth.js";
import { beginBattle, findBattle, stateOf, takeTurn } from "../battles.js";
import type { TurnInput } from "../battles.js";
import { jsonBodyLimit, readBody } from "../http.js";
import { refuse } from "../refusals.js";
import type { Runtime } from "../runtime.js";

/** A turn is a move id and a number. */
const MAX_TURN_BYTES = 1024;

const turnSchema: z.ZodType<TurnInput> = z.object({
  moveId: z.string().min(1).max(64),
  /**
   * Which turn this move is for: the turn count the client was last shown.
   * A POST is not safe to repeat, and requests do get repeated — a double
   * click, a retry after a timeout. With this, the second copy is recognisably
   * about a turn that has already been played.
   */
  turn: z.number().int().min(0),
});

export function battleRoutes({ read, perform }: Runtime) {
  const routes = new Hono();

  routes.post("/", (c) => {
    const begun = perform((world) => beginBattle(world, getUserId(c)));
    if (!begun.ok) return refuse(c, begun.error);

    // The same body either way, and the same place to fetch it from. The
    // status says whether this request is what made it.
    const { battle, isNew } = begun.value;
    return c.json(battle, isNew ? 201 : 200, { Location: `/api/battles/${battle.id}` });
  });

  routes.get("/:id", (c) => {
    const row = findBattle(read, getUserId(c), c.req.param("id"));
    if (row === undefined) return refuse(c, { kind: "not_found" });
    return c.json(viewBattle(row.id, stateOf(row)));
  });

  routes.post("/:id/turn", jsonBodyLimit(MAX_TURN_BYTES), async (c) => {
    const body = await readBody(c, turnSchema);
    if (!body.ok) return refuse(c, body.error);

    // Reading the battle, playing the turn and writing it back happen in one
    // synchronous call, so two turns cannot both be played from the same
    // state (runtime.ts).
    const outcome = perform((world) =>
      takeTurn(world, getUserId(c), c.req.param("id"), body.value),
    );
    return outcome.ok ? c.json(outcome.value) : refuse(c, outcome.error);
  });

  return routes;
}
