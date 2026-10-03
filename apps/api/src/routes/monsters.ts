/**
 * Monster routes — what the player owns.
 *
 *   GET /api/monsters   the player's monsters, the one they fight with first
 *
 * Whose monsters is decided by `getUserId(c)`, as everywhere. What is sent is
 * a view: the level and the health are worked out here, on the way out, from
 * the two numbers that are stored (`viewMonster` in `@mba/core`). The browser
 * is not sent the stored numbers to do that sum itself, and there is nowhere
 * for it to send a level or a health back to.
 */

import { Hono } from "hono";

import { viewMonster } from "@mba/core";
import type { MonsterView } from "@mba/core";
import type { Db } from "@mba/db";

import { getUserId } from "../auth.js";
import { monstersOf } from "../monsters.js";

export function monsterRoutes(db: Db) {
  const routes = new Hono();

  routes.get("/", (c) => {
    const owned: MonsterView[] = monstersOf(db, getUserId(c)).map((monster) =>
      viewMonster(monster),
    );
    return c.json(owned);
  });

  return routes;
}
