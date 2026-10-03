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
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import { TILE_KINDS, checkMap, checkMove, checkSpecies, err, ok } from "@mba/core";
import type {
  MapError,
  MapInput,
  MoveError,
  MoveInput,
  Result,
  SpeciesError,
  SpeciesInput,
} from "@mba/core";
import type { Db } from "@mba/db";

import { requireAdmin } from "../auth.js";
import { jsonBodyLimit, parseShape, readJson } from "../http.js";
import { findAdminMap, listMaps, saveMap } from "../maps.js";
import {
  findAdminSpecies,
  findMove,
  listMoves,
  listSpecies,
  saveMove,
  saveSpecies,
} from "../monsters.js";
import { RETIRABLE, firstUnusable, livenessOf, setRetired } from "../retirement.js";
import type { Retirable } from "../retirement.js";
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
});

const moveSchema: z.ZodType<MoveInput> = z.object({
  name: z.string(),
  power: z.number(),
});

const retiredSchema = z.object({ retired: z.boolean() });

type InputError =
  | { kind: "bad_json" }
  | { kind: "malformed"; at: string }
  /** The thing referred to does not exist … */
  | { kind: "unknown_skin"; skinId: string }
  | { kind: "unknown_move"; moveId: string }
  | { kind: "unknown_species"; speciesId: string }
  /** … or it does, and has been retired: nothing new may point at it. */
  | { kind: "retired_skin"; skinId: string }
  | { kind: "retired_move"; moveId: string }
  | { kind: "retired_species"; speciesId: string };

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
    // The database would refuse a missing one too (foreign keys), but by
    // throwing. Asking first turns "that skin does not exist" into an answer.
    // A retired one the database would accept; refusing it is this API's rule.
    const skin = firstUnusable(db, "skins", [input.skinId]);
    if (skin !== undefined) {
      return err({
        kind: skin.why === "missing" ? "unknown_skin" : "retired_skin",
        skinId: skin.id,
      });
    }
    const move = firstUnusable(db, "moves", input.moveIds);
    if (move !== undefined) {
      return err({
        kind: move.why === "missing" ? "unknown_move" : "retired_move",
        moveId: move.id,
      });
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
    return c.json(findAdminSpecies(db, id), 201, { Location: `/api/admin/species/${id}` });
  });

  routes.put("/species/:id", jsonBodyLimit(MAX_SPECIES_BYTES), async (c) => {
    const id = c.req.param("id");
    // PUT replaces; it does not create. Ids are handed out by POST.
    if (livenessOf(db, "species", id) === "missing") {
      return c.json({ error: { kind: "not_found" } }, 404);
    }

    const input = await readSpecies(c);
    if (!input.ok) return c.json({ error: input.error }, 400);

    saveSpecies(db, id, input.value);
    return c.json(findAdminSpecies(db, id));
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
    const kind = firstUnusable(
      db,
      "species",
      input.encounters.map((encounter) => encounter.speciesId),
    );
    if (kind !== undefined) {
      return err({
        kind: kind.why === "missing" ? "unknown_species" : "retired_species",
        speciesId: kind.id,
      });
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
  // Moves
  // -------------------------------------------------------------------------

  /** Shape, then the rule. A move refers to nothing, so there is no third step. */
  async function readMove(c: Context): Promise<Result<MoveInput, InputError | MoveError>> {
    const body = await readJson(c);
    if (!body.ok) return body;
    const shape = parseShape(moveSchema, body.value);
    if (!shape.ok) return shape;
    return checkMove(shape.value);
  }

  routes.get("/moves", (c) => c.json(listMoves(db)));

  routes.post("/moves", jsonBodyLimit(MAX_SMALL_BYTES), async (c) => {
    const input = await readMove(c);
    if (!input.ok) return c.json({ error: input.error }, 400);

    const id = crypto.randomUUID();
    saveMove(db, id, input.value);
    return c.json(findMove(db, id), 201, { Location: `/api/admin/moves/${id}` });
  });

  routes.put("/moves/:id", jsonBodyLimit(MAX_SMALL_BYTES), async (c) => {
    const id = c.req.param("id");
    if (livenessOf(db, "moves", id) === "missing") {
      return c.json({ error: { kind: "not_found" } }, 404);
    }

    const input = await readMove(c);
    if (!input.ok) return c.json({ error: input.error }, 400);

    saveMove(db, id, input.value);
    return c.json(findMove(db, id));
  });

  // -------------------------------------------------------------------------
  // Skins
  //
  // Read-only here: a skin is drawn in the editor and saved through the game
  // API. What an admin can do to one is retire it, below.
  // -------------------------------------------------------------------------

  routes.get("/skins", (c) => c.json(listSkins(db)));

  // -------------------------------------------------------------------------
  // Retiring — one route shape for all four kinds
  // -------------------------------------------------------------------------

  /** One of them, as its list shows it. */
  const viewOf = (kind: Retirable, id: string) => {
    if (kind === "species") return findAdminSpecies(db, id);
    if (kind === "moves") return findMove(db, id);
    if (kind === "maps") return findAdminMap(db, id);
    return findSkinSummary(db, id);
  };

  for (const kind of RETIRABLE) {
    // PUT, and a body that says what should be true: the request is the same
    // whether it is sent once or five times, and bringing something back is
    // the same request with the other value.
    routes.put(`/${kind}/:id/retired`, jsonBodyLimit(MAX_SMALL_BYTES), async (c) => {
      const id = c.req.param("id");
      const body = await readJson(c);
      if (!body.ok) return c.json({ error: body.error }, 400);
      const shape = parseShape(retiredSchema, body.value);
      if (!shape.ok) return c.json({ error: shape.error }, 400);

      const done = setRetired(db, kind, id, shape.value.retired, new Date());
      if (!done.ok) {
        return c.json({ error: done.error }, done.error.kind === "not_found" ? 404 : 400);
      }
      return c.json(viewOf(kind, id));
    });
  }

  return routes;
}
