/**
 * Hono API — the only process that talks to the database.
 *
 * This file is the composition root: it reads the environment, opens the
 * database, and starts listening. The routes themselves live in `app.ts`,
 * which takes its dependencies as arguments and can therefore be built in a
 * test without any of that.
 *
 * In production this process also serves both built SPAs, so the whole app is
 * one container on one port.
 */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

import { createDb, runMigrations } from "@mba/db";

import { createApp } from "./app.js";
import { ensureLocalUser } from "./auth.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "file:./data/app.db";
const PORT = Number(process.env.PORT ?? 3000);

const db = createDb(DATABASE_URL);
// Self-migrating on boot: a fresh clone plus `pnpm dev` just works, and the
// production container needs no separate migrate step.
const { applied } = runMigrations(db);
ensureLocalUser(db);

const app = createApp({ db, migrationsApplied: applied });

if (process.env.NODE_ENV === "production") {
  // One container, one port: the API also serves both SPA builds.
  app.use(
    "/admin/*",
    serveStatic({
      root: "./apps/admin/dist",
      rewriteRequestPath: (p) => p.replace(/^\/admin/, ""),
    }),
  );
  app.use("/*", serveStatic({ root: "./apps/web/dist" }));
}

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(
    `api listening on http://0.0.0.0:${info.port} (db: ${DATABASE_URL}, migrations: ${applied})`,
  );
});
