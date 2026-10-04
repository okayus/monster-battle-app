/**
 * The admin API: writing the master data that the game API only reads.
 *
 *   GET            /api/admin/species        every species, with its moves
 *   POST           /api/admin/species        create one
 *   PUT            /api/admin/species/:id    replace one
 *   GET            /api/admin/maps           every map, with who turns up on it
 *   POST           /api/admin/maps           create one
 *   PUT            /api/admin/maps/:id       replace one
 *   GET            /api/admin/moves          every move
 *   POST           /api/admin/moves          create one
 *   PUT            /api/admin/moves/:id      replace one
 *   GET            /api/admin/skins          every skin, by name
 *
 *   PUT            /api/admin/{species|moves|maps|skins}/:id/retired
 *                                            take one out of use, or bring it back
 *
 * There is no DELETE. Master data is referred to by saves, battles and owned
 * monsters, so it is never removed (docs/03-data-model.md §削除しない). What
 * there is instead is retiring, and the rules for it are in `retirement.ts`.
 * The lists here include what has been retired, marked as such: an admin has
 * to be able to see a thing to bring it back.
 *
 * Every route here is behind the same check, attached once at the top of this
 * router. Adding a route below cannot forget it.
 *
 * What is here is the HTTP part only. Whether a move, a species or a map may
 * be stored is decided in master.ts, and whether something may be retired in
 * retirement.ts. What a write answers with is read back out of the database
 * afterwards, by the function its list uses: what is on screen straight after
 * saving is what a reload would show.
 */

import { Hono } from "hono";
import { z } from "zod";

import { TILE_KINDS } from "@mba/core";
import type { MapInput, MoveInput, SpeciesInput } from "@mba/core";

import { requireAdmin } from "../auth.js";
import { jsonBodyLimit, readBody } from "../http.js";
import { findAdminMap, listMaps } from "../maps.js";
import {
  createMap,
  createMove,
  createSpecies,
  replaceMap,
  replaceMove,
  replaceSpecies,
} from "../master.js";
import { findAdminSpecies, findMove, listMoves, listSpecies } from "../monsters.js";
import { refuse } from "../refusals.js";
import { RETIRABLE, setRetired } from "../retirement.js";
import type { Retirable } from "../retirement.js";
import type { Runtime } from "../runtime.js";
import { findSkinSummary, listSkins } from "../skins.js";

/** A species is a handful of numbers and ids. */
const MAX_SPECIES_BYTES = 4 * 1024;

/** A move is a name and a number; "retired" is one word. */
const MAX_SMALL_BYTES = 1024;

/** The largest map allowed is 32×32 tile names, about 10 KB. */
const MAX_MAP_BYTES = 64 * 1024;

/**
 * Shape only: is each field there, and of the right type. The ranges — a stat
 * of at least 1, a spawn that can be stood on — are `@mba/core`'s to decide.
 */
const speciesSchema: z.ZodType<SpeciesInput> = z.object({
  name: z.string(),
  maxHp: z.number(),
  attack: z.number(),
  defense: z.number(),
  skinId: z.string(),
  moveIds: z.array(z.string()),
});

const mapSchema: z.ZodType<MapInput> = z.object({
  name: z.string(),
  width: z.number(),
  height: z.number(),
  // Which words are tile kinds is shape, not a rule: a tile that is not one of
  // these is not a tile.
  tiles: z.array(z.enum(TILE_KINDS)),
  spawn: z.object({ x: z.number(), y: z.number() }),
  encounters: z.array(z.object({ speciesId: z.string(), weight: z.number() })),
  exits: z.array(
    z.object({
      at: z.object({ x: z.number(), y: z.number() }),
      to: z.object({
        mapId: z.string(),
        position: z.object({ x: z.number(), y: z.number() }),
      }),
    }),
  ),
});

const moveSchema: z.ZodType<MoveInput> = z.object({
  name: z.string(),
  power: z.number(),
});

const retiredSchema = z.object({ retired: z.boolean() });

export function adminRoutes({ read, perform }: Runtime) {
  const routes = new Hono();

  // The one place authorization for the admin API is decided.
  routes.use("*", requireAdmin(read));

  // -------------------------------------------------------------------------
  // Species
  // -------------------------------------------------------------------------

  routes.get("/species", (c) => c.json(listSpecies(read)));

  routes.post("/species", jsonBodyLimit(MAX_SPECIES_BYTES), async (c) => {
    const body = await readBody(c, speciesSchema);
    if (!body.ok) return refuse(c, body.error);

    const saved = perform((world) => createSpecies(world, body.value));
    if (!saved.ok) return refuse(c, saved.error);

    const { id } = saved.value;
    return c.json(findAdminSpecies(read, id), 201, { Location: `/api/admin/species/${id}` });
  });

  routes.put("/species/:id", jsonBodyLimit(MAX_SPECIES_BYTES), async (c) => {
    // The body is handed over as it was read, good or bad: a species that is
    // not there is "not found" before anything is said about the body.
    const body = await readBody(c, speciesSchema);
    const saved = perform((world) => replaceSpecies(world, c.req.param("id"), body));
    if (!saved.ok) return refuse(c, saved.error);
    return c.json(findAdminSpecies(read, saved.value.id));
  });

  // -------------------------------------------------------------------------
  // Maps
  // -------------------------------------------------------------------------

  routes.get("/maps", (c) => c.json(listMaps(read)));

  routes.post("/maps", jsonBodyLimit(MAX_MAP_BYTES), async (c) => {
    const body = await readBody(c, mapSchema);
    if (!body.ok) return refuse(c, body.error);

    const saved = perform((world) => createMap(world, body.value));
    if (!saved.ok) return refuse(c, saved.error);

    const { id } = saved.value;
    return c.json(findAdminMap(read, id), 201, { Location: `/api/admin/maps/${id}` });
  });

  routes.put("/maps/:id", jsonBodyLimit(MAX_MAP_BYTES), async (c) => {
    const body = await readBody(c, mapSchema);
    const saved = perform((world) => replaceMap(world, c.req.param("id"), body));
    if (!saved.ok) return refuse(c, saved.error);
    return c.json(findAdminMap(read, saved.value.id));
  });

  // -------------------------------------------------------------------------
  // Moves
  // -------------------------------------------------------------------------

  routes.get("/moves", (c) => c.json(listMoves(read)));

  routes.post("/moves", jsonBodyLimit(MAX_SMALL_BYTES), async (c) => {
    const body = await readBody(c, moveSchema);
    if (!body.ok) return refuse(c, body.error);

    const saved = perform((world) => createMove(world, body.value));
    if (!saved.ok) return refuse(c, saved.error);

    const { id } = saved.value;
    return c.json(findMove(read, id), 201, { Location: `/api/admin/moves/${id}` });
  });

  routes.put("/moves/:id", jsonBodyLimit(MAX_SMALL_BYTES), async (c) => {
    const body = await readBody(c, moveSchema);
    const saved = perform((world) => replaceMove(world, c.req.param("id"), body));
    if (!saved.ok) return refuse(c, saved.error);
    return c.json(findMove(read, saved.value.id));
  });

  // -------------------------------------------------------------------------
  // Skins
  //
  // Read-only here: a skin is drawn in the editor and saved through the game
  // API. What an admin can do to one is retire it, below.
  // -------------------------------------------------------------------------

  routes.get("/skins", (c) => c.json(listSkins(read)));

  // -------------------------------------------------------------------------
  // Retiring — one route shape for all four kinds
  // -------------------------------------------------------------------------

  /** One of them, as its list shows it. */
  const viewOf = (kind: Retirable, id: string) => {
    if (kind === "species") return findAdminSpecies(read, id);
    if (kind === "moves") return findMove(read, id);
    if (kind === "maps") return findAdminMap(read, id);
    return findSkinSummary(read, id);
  };

  for (const kind of RETIRABLE) {
    // PUT, and a body that says what should be true: the request is the same
    // whether it is sent once or five times, and bringing something back is
    // the same request with the other value.
    routes.put(`/${kind}/:id/retired`, jsonBodyLimit(MAX_SMALL_BYTES), async (c) => {
      const id = c.req.param("id");
      const body = await readBody(c, retiredSchema);
      if (!body.ok) return refuse(c, body.error);

      const done = perform((world) => setRetired(world, kind, id, body.value.retired));
      if (!done.ok) return refuse(c, done.error);
      return c.json(viewOf(kind, id));
    });
  }

  return routes;
}
