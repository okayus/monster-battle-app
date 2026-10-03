/**
 * Builds the Hono app from its dependencies, and does nothing else.
 *
 * Kept apart from `index.ts` so that the app can be constructed without
 * opening a port or a database file: the tests hand it an in-memory database
 * and call `app.request()` directly. `index.ts` is the only place that reads
 * the environment and starts listening.
 *
 * Route layout (docs/04-api-design.md):
 *   /api/health          liveness
 *   /api/...             player-facing game API
 *   /api/admin/...       master-data authoring API (separate prefix so that
 *                        authorization can be attached in exactly one place)
 */

import { Hono } from "hono";

import type { Db } from "@mba/db";

import { adminRoutes } from "./routes/admin.js";
import { appearanceRoutes } from "./routes/appearance.js";
import { battleRoutes } from "./routes/battles.js";
import { mapRoutes } from "./routes/maps.js";
import { saveRoutes } from "./routes/save.js";
import { skinRoutes } from "./routes/skins.js";

export interface AppDeps {
  db: Db;
  /** Reported by /api/health, so a boot that migrated is visible from outside. */
  migrationsApplied: number;
  /**
   * Where the server's random numbers come from: `Math.random` when it is
   * really running, a scripted sequence in tests. Handlers draw from this and
   * pass the numbers on; nothing in `@mba/core` draws its own.
   */
  random: () => number;
}

export function createApp({ db, migrationsApplied, random }: AppDeps) {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ status: "ok", migrationsApplied }));

  app.route("/api/skins", skinRoutes(db));
  app.route("/api/maps", mapRoutes(db));
  app.route("/api/save", saveRoutes(db));
  app.route("/api/appearance", appearanceRoutes(db));
  app.route("/api/battles", battleRoutes(db, random));

  // Everything under this prefix goes through one authorization check, which
  // the admin router attaches to itself.
  app.route("/api/admin", adminRoutes(db));

  // Not built: /api/me and /api/monsters. Nothing on screen needs them yet
  // (docs/04-api-design.md §ゲーム API).

  return app;
}
