/**
 * Battle routes.
 *
 *   POST /api/battles            start a battle where the player is standing —
 *                                or go back to the one that is not over yet
 *   GET  /api/battles/:id        the battle as the screen needs it
 *   POST /api/battles/:id/turn   play one turn: the body names a move, nothing else
 *
 * The browser decides one thing in a battle: which move to use. Who the enemy
 * is, how much damage a hit does and who won are all decided here, with the
 * rules in `@mba/core` and random numbers this process draws. The state lives
 * in the database between requests, and the browser is never asked for it
 * back.
 *
 * What a battle leaves behind is decided here as well. The turn that ends a
 * battle also writes what the monster earned and what it lost, and where a
 * player who lost is put — in the same transaction as the battle's own last
 * state. There is no second request that collects a reward, so there is
 * nothing to collect twice and nothing left uncollected.
 */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import {
  combatantOf,
  hasWildMonsters,
  pickWeighted,
  playTurn,
  settle,
  startBattle,
  tileAt,
  viewBattle,
  wildCombatant,
} from "@mba/core";
import type { TurnOutcome } from "@mba/core";
import { battles, ownedMonsters } from "@mba/db";
import type { Db } from "@mba/db";

import { getUserId } from "../auth.js";
import { ongoingBattleOf, stateOf } from "../battles.js";
import { commit } from "../changes.js";
import { jsonBodyLimit, parseShape, readJson } from "../http.js";
import { findMap } from "../maps.js";
import { encountersOn, leadMonsterOf } from "../monsters.js";
import { loadSave, startingPoint } from "../saves.js";

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

    // One battle at a time. The monster's health carries over from battle to
    // battle, so a second one started beside the first would begin from the
    // health the first has not finished taking. A battle that is not over is
    // therefore the one the player is given: no roll is drawn, and nothing is
    // written. Leaving the screen halfway does not get anyone out of a fight.
    const unfinished = ongoingBattleOf(db, mine.id);
    if (unfinished !== undefined) {
      return c.json(viewBattle(unfinished.id, stateOf(unfinished)), 200, {
        Location: `/api/battles/${unfinished.id}`,
      });
    }

    // The roll is drawn here and handed to the rule that uses it.
    const wild = pickWeighted(encountersOn(db, map.id), random());
    if (wild === undefined) return c.json({ error: { kind: "no_encounters_here" } }, 400);

    // The player's monster goes in as it is now: grown to its level, with the
    // health it has left. Which monster this is is written on the battle, so
    // that the end of the battle knows whose numbers to change.
    const state = startBattle(combatantOf(mine), wildCombatant(wild));
    const id = crypto.randomUUID();
    const now = new Date();
    db.insert(battles)
      .values({
        id,
        userId,
        monsterId: mine.id,
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
    return c.json(viewBattle(row.id, stateOf(row)));
  });

  routes.post("/:id/turn", jsonBodyLimit(MAX_TURN_BYTES), async (c) => {
    const body = await readJson(c);
    if (!body.ok) return c.json({ error: body.error }, 400);

    const shape = parseShape(turnSchema, body.value);
    if (!shape.ok) return c.json({ error: shape.error }, 400);

    // Nothing below this line awaits. Reading the battle, playing the turn and
    // writing it back happen without another request getting in between, so
    // two turns cannot both be played from the same state.
    const userId = getUserId(c);
    const row = findBattle(c.req.param("id"), userId);
    if (row === undefined) return c.json({ error: { kind: "not_found" } }, 404);

    const state = stateOf(row);
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
    const events = [...played.value.events];
    const now = new Date();
    // Looked up before the transaction opens: it is only read, and only needed
    // if this turn lost the battle.
    const home = next.status === "lost" ? startingPoint(db) : undefined;

    // One transaction for everything this turn changes. A battle that reads
    // "won" beside a monster that was never paid, or a monster paid for a
    // battle still marked as going on, would each be a state nobody can put
    // right afterwards. Either all of it is written or none of it is, and
    // then the turn has not been played and can be sent again.
    db.transaction((tx) => {
      tx.update(battles)
        .set({ status: next.status, state: JSON.stringify(next), updatedAt: now })
        .where(eq(battles.id, row.id))
        .run();

      // A battle from before monsters kept anything has no monster written on
      // it, and ends the way it began: nothing is carried out of it.
      const { monsterId } = row;
      if (monsterId === null) return;

      const fighter = tx
        .select({ exp: ownedMonsters.exp })
        .from(ownedMonsters)
        .where(eq(ownedMonsters.id, monsterId))
        .get();
      // Nothing to settle while the battle is still going.
      const settled = fighter === undefined ? undefined : settle(fighter, next);
      if (settled === undefined) return;

      tx.update(ownedMonsters)
        .set({ exp: settled.exp, damage: settled.damage })
        .where(eq(ownedMonsters.id, monsterId))
        .run();
      events.push(...settled.events);

      // Losing costs the player where they had got to. Like every other change
      // of position that matters, it is the server that makes it; the battle
      // screen is only told the battle was lost.
      if (home !== undefined) commit(tx, [{ kind: "player_placed", userId, at: home }], now);
    });

    const outcome: TurnOutcome = { battle: viewBattle(row.id, next), events };
    return c.json(outcome);
  });

  return routes;
}
