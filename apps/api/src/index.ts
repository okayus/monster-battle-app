/**
 * Hono API — the only process that talks to the database.
 *
 * Route layout (docs/04-api-design.md):
 *   /api/health          liveness
 *   /api/...             player-facing game API
 *   /api/admin/...       master-data authoring API (separate prefix so that
 *                        authorization can be attached in exactly one place)
 *
 * In production this process also serves both built SPAs, so the whole app is
 * one container on one port.
 */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

import { createDb, runMigrations } from "@mba/db";

const DATABASE_URL = process.env.DATABASE_URL ?? "file:./data/app.db";
const PORT = Number(process.env.PORT ?? 3000);

const db = createDb(DATABASE_URL);
// Self-migrating on boot: a fresh clone plus `pnpm dev` just works, and the
// production container needs no separate migrate step.
const { applied } = runMigrations(db);

const app = new Hono();

app.get("/api/health", (c) => c.json({ status: "ok", migrationsApplied: applied }));

// TODO: player game API      — see docs/04-api-design.md §ゲーム API
// TODO: skin API             — see docs/02-sprite-format.md (validation is the boundary)
// TODO: /api/admin/*         — see docs/04-api-design.md §管理 API

if (process.env.NODE_ENV === "production") {
  // One container, one port: the API also serves both SPA builds.
  app.use("/admin/*", serveStatic({ root: "./apps/admin/dist", rewriteRequestPath: (p) => p.replace(/^\/admin/, "") }));
  app.use("/*", serveStatic({ root: "./apps/web/dist" }));
}

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`api listening on http://0.0.0.0:${info.port} (db: ${DATABASE_URL}, migrations: ${applied})`);
});
