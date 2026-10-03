/**
 * Battle routes.
 *
 *   POST /api/battles            start a battle where the player is standing
 *   GET  /api/battles/:id        the battle as the screen needs it
 *   POST /api/battles/:id/turn   play one turn: the body names a move, nothing else
 *
 * The browser decides one thing in a battle: which move to use. Who the enemy
 * is, how much damage a hit does and who won are all decided here, with the
 * rules in `@mba/core` and random numbers this process draws. The state lives
 * in the database between requests, and the browser is never asked for it
 * back.
 */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import {
  combatantOf,
  hasWildMonsters,
  pickWeighted,
  playTurn,
  startBattle,
  tileAt,
  viewBattle,
} from "@mba/core";
import type { BattleState, TurnOutcome } from "@mba/core";
import { battles } from "@mba/db";
import type { Db } from "@mba/db";

import { getUserId } from "../auth.js";
import { jsonBodyLimit, parseShape, readJson } from "../http.js";
import { findMap } from "../maps.js";
import { encountersOn, leadMonsterOf } from "../monsters.js";
import { loadSave } from "../saves.js";

/** A turn is a move id and a number. */
const MAX_TURN_BYTES = 1024;

const turnSchema = z.object({
  moveId: z.string().min(1).max(64),
  /**
   * Which turn this move is for: the turn count the client was last shown.
   * A POST is not safe to repeat, and requests do get repeated — a double
   * click, a retry after a timeout. With this, the second copy is recognisably
   * about a turn that has already been played.
   */
  turn: z.number().int().min(0),
});

export function battleRoutes(db: Db, random: () => number) {
  const routes = new Hono();

  /** A battle, but only if it is this user's. Someone else's does not exist. */
  const findBattle = (id: string, userId: string) =>
    db
      .select()
      .from(battles)
      .where(and(eq(battles.id, id), eq(battles.userId, userId)))
      .get();

  routes.post("/", (c) => {
    const userId = getUserId(c);

    // Where the player is comes from the server's own record, not from the
    // request: a battle starts on the tile the last save put them on.
    const save = loadSave(db, userId);
    const map = save === undefined ? undefined : findMap(db, save.mapId);
    if (save === undefined || map === undefined) {
      return c.json({ error: { kind: "no_start_map" } }, 500);
    }
    const tile = tileAt(map, save.position);
    if (tile === undefined || !hasWildMonsters(tile)) {
      return c.json({ error: { kind: "no_encounters_here" } }, 400);
    }

    const mine = leadMonsterOf(db, userId);
    if (mine === undefined) return c.json({ error: { kind: "no_monster" } }, 400);

    // The roll is drawn here and handed to the rule that uses it.
    const wild = pickWeighted(encountersOn(db, map.id), random());
    if (wild === undefined) return c.json({ error: { kind: "no_encounters_here" } }, 400);

    const state = startBattle(combatantOf(mine.species, mine.nickname), combatantOf(wild));
    const id = crypto.randomUUID();
    const now = new Date();
    db.insert(battles)
      .values({
        id,
        userId,
        status: state.status,
        state: JSON.stringify(state),
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return c.json(viewBattle(id, state), 201, { Location: `/api/battles/${id}` });
  });

  routes.get("/:id", (c) => {
    const row = findBattle(c.req.param("id"), getUserId(c));
    if (row === undefined) return c.json({ error: { kind: "not_found" } }, 404);
    return c.json(viewBattle(row.id, JSON.parse(row.state) as BattleState));
  });

  routes.post("/:id/turn", jsonBodyLimit(MAX_TURN_BYTES), async (c) => {
    const body = await readJson(c);
    if (!body.ok) return c.json({ error: body.error }, 400);

    const shape = parseShape(turnSchema, body.value);
    if (!shape.ok) return c.json({ error: shape.error }, 400);

    // Nothing below this line awaits. Reading the battle, playing the turn and
    // writing it back happen without another request getting in between, so
    // two turns cannot both be played from the same state.
    const row = findBattle(c.req.param("id"), getUserId(c));
    if (row === undefined) return c.json({ error: { kind: "not_found" } }, 404);

    const state = JSON.parse(row.state) as BattleState;
    if (shape.value.turn !== state.turn) {
      return c.json({ error: { kind: "stale_turn", turn: state.turn } }, 400);
    }

    const played = playTurn(state, shape.value.moveId, {
      playerVariance: random(),
      enemyMove: random(),
      enemyVariance: random(),
    });
    if (!played.ok) return c.json({ error: played.error }, 400);

    const next = played.value.state;
    db.update(battles)
      .set({ status: next.status, state: JSON.stringify(next), updatedAt: new Date() })
      .where(eq(battles.id, row.id))
      .run();

    const outcome: TurnOutcome = { battle: viewBattle(row.id, next), events: played.value.events };
    return c.json(outcome);
  });

  return routes;
}
