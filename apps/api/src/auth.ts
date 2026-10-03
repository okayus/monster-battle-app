/**
 * Who is making this request — the one place that question is answered.
 *
 * There is no real authentication yet, by design (docs/04-api-design.md): this
 * app runs locally, for one person. What matters now is the shape. Handlers
 * ask `getUserId(c)` and never read an id out of the request themselves, so on
 * the day real authentication arrives this file changes and no handler does.
 *
 * The rule that makes that swap safe: an id that arrives in a request body
 * never decides whose data gets written. A handler that trusted `body.ownerId`
 * would stay exploitable after authentication was added — knowing who the
 * caller is does not help if the caller gets to say who they are acting as.
 */

import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";

import { users } from "@mba/db";
import type { Db } from "@mba/db";

/** The single user this app has, until there is a way to tell users apart. */
export const LOCAL_USER_ID = "local";

export function getUserId(_c: Context): string {
  return LOCAL_USER_ID;
}

/**
 * Makes sure the local user's row exists. Anything a user owns references
 * `users.id`, so the row has to be there before the first such write.
 * Idempotent: it runs on every boot.
 */
export function ensureLocalUser(db: Db): void {
  db.insert(users)
    .values({ id: LOCAL_USER_ID, displayName: "プレイヤー", isAdmin: true, createdAt: new Date() })
    // The local user is whoever is running this app on their own machine, so
    // they are its admin — including in a database that was created before
    // the flag existed, which is why this updates instead of doing nothing.
    .onConflictDoUpdate({ target: users.id, set: { isAdmin: true } })
    .run();
}

/**
 * The guard on the admin API.
 *
 * Two separate questions meet here. Who is asking is `getUserId(c)`, the same
 * as everywhere else. Whether they may is a fact about that user, read from
 * the database. Real authentication will change how the first is answered and
 * leave the second alone.
 *
 * It is attached once, to the router every admin route lives in (see
 * routes/admin.ts), not to each route — so a route added later cannot be left
 * unguarded by forgetting a line.
 */
export function requireAdmin(db: Db): MiddlewareHandler {
  return async (c, next) => {
    const user = db
      .select({ isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, getUserId(c)))
      .get();
    if (user?.isAdmin !== true) return c.json({ error: { kind: "forbidden" } }, 403);
    await next();
  };
}
