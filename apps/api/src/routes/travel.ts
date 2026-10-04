/**
 * The travel route — the only way from one map to another.
 *
 *   POST /api/travel   go through the exit the player is standing on
 *
 * There is no body. Which exit, and where it leads, are both read from what
 * the server already has (`takeExit` in saves.ts). The browser can say "go
 * through", and nothing else — the same shape as starting a battle
 * (routes/battles.ts).
 *
 * This is where the line about positions was redrawn (docs/04-api-design.md).
 * Inside a map, a save is stored if the player could have walked there.
 * Between maps there is a different question, and this route is the one that
 * asks it.
 */

import { Hono } from "hono";

import { getUserId } from "../auth.js";
import { refuse } from "../refusals.js";
import type { Runtime } from "../runtime.js";
import { takeExit } from "../saves.js";

export function travelRoutes({ perform }: Runtime) {
  const routes = new Hono();

  routes.post("/", (c) => {
    const arrived = perform((world) => takeExit(world, getUserId(c)));
    return arrived.ok ? c.json(arrived.value) : refuse(c, arrived.error);
  });

  return routes;
}
