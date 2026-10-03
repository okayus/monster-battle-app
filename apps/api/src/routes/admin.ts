/**
 * The admin API: writing the master data that the game API only reads.
 *
 *   GET            /api/admin/species        every species, with its moves
 *   POST           /api/admin/species        create one
 *   PUT            /api/admin/species/:id    replace one
 *   GET            /api/admin/maps           every map, with who turns up on it
 *   POST           /api/admin/maps           create one
 *   PUT            /api/admin/maps/:id       replace one
 *   GET            /api/admin/moves          the moves a species can be given
 *   GET            /api/admin/skins          the skins a species can be drawn with
 *
 * There is no DELETE. Master data is referred to by saves, battles and owned
 * monsters, so it is never removed (docs/03-data-model.md §削除しない).
 *
 * Every route here is behind the same check, attached once at the top of this
 * router. Adding a route below cannot forget it.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import { TILE_KINDS, checkMap, checkSpecies, err, ok } from "@mba/core";
import type { MapError, MapInput, Result, SpeciesError, SpeciesInput } from "@mba/core";
import type { Db } from "@mba/db";

import { requireAdmin } from "../auth.js";
import { jsonBodyLimit, parseShape, readJson } from "../http.js";
import { findAdminMap, listMaps, saveMap } from "../maps.js";
import {
  findSpecies,
  listMoves,
  listSpecies,
  moveExists,
  saveSpecies,
  speciesExists,
} from "../monsters.js";
import { listSkins, skinExists } from "../skins.js";

/** A species is a handful of numbers and ids. */
const MAX_SPECIES_BYTES = 4 * 1024;

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
});

type InputError =
  | { kind: "bad_json" }
  | { kind: "malformed"; at: string }
  | { kind: "unknown_skin"; skinId: string }
  | { kind: "unknown_move"; moveId: string }
  | { kind: "unknown_species"; speciesId: string };

export function adminRoutes(db: Db) {
  const routes = new Hono();

  // The one place authorization for the admin API is decided.
  routes.use("*", requireAdmin(db));

  // -------------------------------------------------------------------------
  // Species
  // -------------------------------------------------------------------------

  /**
   * A request body as a species that is safe to store: shape, then the game's
   * rules, then whether the things it refers to exist. Each step only runs if
   * the one before it passed, and all of them come out as one error value.
   */
  async function readSpecies(c: Context): Promise<Result<SpeciesInput, InputError | SpeciesError>> {
    const body = await readJson(c);
    if (!body.ok) return body;
    const shape = parseShape(speciesSchema, body.value);
    if (!shape.ok) return shape;
    const checked = checkSpecies(shape.value);
    if (!checked.ok) return checked;

    const input = checked.value;
    // The database would refuse these too (foreign keys), but by throwing.
    // Asking first turns "that skin does not exist" into an answer.
    if (!skinExists(db, input.skinId)) return err({ kind: "unknown_skin", skinId: input.skinId });
    for (const moveId of input.moveIds) {
      if (!moveExists(db, moveId)) return err({ kind: "unknown_move", moveId });
    }
    return ok(input);
  }

  routes.get("/species", (c) => c.json(listSpecies(db)));

  routes.post("/species", jsonBodyLimit(MAX_SPECIES_BYTES), async (c) => {
    const input = await readSpecies(c);
    if (!input.ok) return c.json({ error: input.error }, 400);

    // The id is the server's to choose. A body that carries one is ignored.
    const id = crypto.randomUUID();
    saveSpecies(db, id, input.value);
    return c.json(findSpecies(db, id), 201, { Location: `/api/admin/species/${id}` });
  });

  routes.put("/species/:id", jsonBodyLimit(MAX_SPECIES_BYTES), async (c) => {
    const id = c.req.param("id");
    // PUT replaces; it does not create. Ids are handed out by POST.
    if (!speciesExists(db, id)) return c.json({ error: { kind: "not_found" } }, 404);

    const input = await readSpecies(c);
    if (!input.ok) return c.json({ error: input.error }, 400);

    saveSpecies(db, id, input.value);
    return c.json(findSpecies(db, id));
  });

  // -------------------------------------------------------------------------
  // Maps
  // -------------------------------------------------------------------------

  async function readMap(c: Context): Promise<Result<MapInput, InputError | MapError>> {
    const body = await readJson(c);
    if (!body.ok) return body;
    const shape = parseShape(mapSchema, body.value);
    if (!shape.ok) return shape;
    const checked = checkMap(shape.value);
    if (!checked.ok) return checked;

    const input = checked.value;
    for (const { speciesId } of input.encounters) {
      if (!speciesExists(db, speciesId)) return err({ kind: "unknown_species", speciesId });
    }
    return ok(input);
  }

  routes.get("/maps", (c) => c.json(listMaps(db)));

  routes.post("/maps", jsonBodyLimit(MAX_MAP_BYTES), async (c) => {
    const input = await readMap(c);
    if (!input.ok) return c.json({ error: input.error }, 400);

    const id = crypto.randomUUID();
    saveMap(db, id, input.value);
    return c.json(findAdminMap(db, id), 201, { Location: `/api/admin/maps/${id}` });
  });

  routes.put("/maps/:id", jsonBodyLimit(MAX_MAP_BYTES), async (c) => {
    const id = c.req.param("id");
    if (findAdminMap(db, id) === undefined) return c.json({ error: { kind: "not_found" } }, 404);

    const input = await readMap(c);
    if (!input.ok) return c.json({ error: input.error }, 400);

    saveMap(db, id, input.value);
    return c.json(findAdminMap(db, id));
  });

  // -------------------------------------------------------------------------
  // What the forms choose from
  // -------------------------------------------------------------------------

  routes.get("/moves", (c) => c.json(listMoves(db)));

  routes.get("/skins", (c) => c.json(listSkins(db)));

  return routes;
}
