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
import { seed } from "./seed.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "file:./data/app.db";
const PORT = Number(process.env.PORT ?? 3000);

const db = createDb(DATABASE_URL);
// Self-migrating on boot: a fresh clone plus `pnpm dev` just works, and the
// production container needs no separate migrate step.
const { applied } = runMigrations(db);

const seeded = seed(db);
if (!seeded.ok) {
  // The seed data is part of the source. If a drawing in it is malformed, that
  // is a bug to fix before serving anything, not a state to keep running in.
  console.error("the seed data is invalid:", seeded.error);
  process.exit(1);
}

// The one place the real random number generator is named.
const app = createApp({ db, migrationsApplied: applied, random: Math.random });

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

const server = serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(
    `api listening on http://0.0.0.0:${info.port} (db: ${DATABASE_URL}, migrations: ${applied})`,
  );
});

/** Longer than any request here should take, shorter than `docker stop` is willing to wait. */
const SHUTDOWN_GRACE_MS = 5000;

/**
 * Stops on request: no new connections, requests in flight get to finish, the
 * database is closed, and the process exits by itself.
 *
 * This has to be written down because in the production container this
 * process is PID 1, and the kernel gives PID 1 no default reaction to a
 * signal. Without a handler `docker stop` sends SIGTERM, nothing happens, and
 * ten seconds later the process is killed outright.
 */
function shutdown(signal: NodeJS.Signals): void {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    db.$client.close();
    process.exit(0);
  });
  // A connection that never finishes must not be able to hold the exit up.
  setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
