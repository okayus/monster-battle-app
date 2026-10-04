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
import { monsterRoutes } from "./routes/monsters.js";
import { saveRoutes } from "./routes/save.js";
import { skinRoutes } from "./routes/skins.js";
import { travelRoutes } from "./routes/travel.js";
import { createRuntime } from "./runtime.js";
import type { Sources } from "./runtime.js";

/**
 * `random`, `now` and `newId` are the three things that differ from one run to
 * the next (see `Sources`). The app is handed them instead of reaching for
 * them: `Math.random`, the clock and the id generator when it is really
 * running, whatever a test wants them to say in a test. Decisions draw from
 * these and pass the values on; nothing in `@mba/core` draws its own.
 */
export interface AppDeps extends Sources {
  db: Db;
  /** Reported by /api/health, so a boot that migrated is visible from outside. */
  migrationsApplied: number;
}

export function createApp({ db, migrationsApplied, ...sources }: AppDeps) {
  const app = new Hono();

  // From here down, the routes that have been moved to the new shape get this
  // and not the database: a way to read, and a way to have a decision carried
  // out (runtime.ts).
  const runtime = createRuntime(db, sources);

  app.get("/api/health", (c) => c.json({ status: "ok", migrationsApplied }));

  app.route("/api/skins", skinRoutes(db));
  app.route("/api/maps", mapRoutes(runtime.read));
  app.route("/api/save", saveRoutes(runtime));
  app.route("/api/travel", travelRoutes(runtime));
  app.route("/api/appearance", appearanceRoutes(db));
  app.route("/api/monsters", monsterRoutes(runtime.read));
  app.route("/api/battles", battleRoutes(runtime));

  // Everything under this prefix goes through one authorization check, which
  // the admin router attaches to itself.
  app.route("/api/admin", adminRoutes(db));

  // Not built: /api/me. Nothing on screen needs it yet
  // (docs/04-api-design.md §ゲーム API).

  return app;
}
