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

import { skinRoutes } from "./routes/skins.js";

export interface AppDeps {
  db: Db;
  /** Reported by /api/health, so a boot that migrated is visible from outside. */
  migrationsApplied: number;
}

export function createApp({ db, migrationsApplied }: AppDeps) {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ status: "ok", migrationsApplied }));

  app.route("/api/skins", skinRoutes(db));

  // TODO: player game API      — see docs/04-api-design.md §ゲーム API
  // TODO: /api/admin/*         — see docs/04-api-design.md §管理 API

  return app;
}
