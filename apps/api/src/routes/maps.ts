/**
 * Map routes.
 *
 *   GET /api/maps/:id   the grid and where a new player starts
 *
 * Read-only on this side of the API. Writing maps belongs to the admin API
 * (`/api/admin/maps`, Step 5), behind its own authorization.
 */

import { Hono } from "hono";

import type { Read } from "@mba/db";

import { findMap } from "../maps.js";
import { refuse } from "../refusals.js";

export function mapRoutes(read: Read) {
  const routes = new Hono();

  routes.get("/:id", (c) => {
    const map = findMap(read, c.req.param("id"));
    if (map === undefined) return refuse(c, { kind: "not_found" });
    return c.json(map);
  });

  return routes;
}
