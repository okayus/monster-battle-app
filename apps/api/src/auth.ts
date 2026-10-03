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

import type { Context } from "hono";

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
    .values({ id: LOCAL_USER_ID, displayName: "プレイヤー", createdAt: new Date() })
    .onConflictDoNothing()
    .run();
}
