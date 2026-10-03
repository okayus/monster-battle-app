/**
 * Map routes.
 *
 *   GET /api/maps/:id   the grid and where a new player starts
 *
 * Read-only on this side of the API. Writing maps belongs to the admin API
 * (`/api/admin/maps`, Step 5), behind its own authorization.
 */

import { Hono } from "hono";

import type { Db } from "@mba/db";

import { findMap } from "../maps.js";

export function mapRoutes(db: Db) {
  const routes = new Hono();

  routes.get("/:id", (c) => {
    const map = findMap(db, c.req.param("id"));
    if (map === undefined) return c.json({ error: { kind: "not_found" } }, 404);
    return c.json(map);
  });

  return routes;
}
