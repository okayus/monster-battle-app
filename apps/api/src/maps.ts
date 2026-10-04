/**
 * Maps: reading them out of the database, and making sure there is one to
 * start on.
 *
 * Maps are master data. They will be edited from the admin screen (Step 5 in
 * docs/05-roadmap.md); until that exists, the only map is the one seeded here.
 */

import { and, asc, eq, isNull, ne } from "drizzle-orm";

import { err, ok } from "@mba/core";
import type {
  AdminMap,
  Encounter,
  GameMap,
  MapExit,
  MapInput,
  MasterReference,
  Position,
  Result,
  TileKind,
} from "@mba/core";
import { mapEncounters, mapExits, maps } from "@mba/db";
import type { Db, MapRow, Read } from "@mba/db";

/** The map a player with no save starts on. */
export const START_MAP_ID = "start";

/**
 * Turns a row into the shape the game logic uses. The row-to-domain conversion
 * exists once, here. The cast on `tiles` is the same one-way trust as wherever
 * else a row is read: what is in the database was checked by the code that put
 * it there.
 */
function toGameMap(row: MapRow, exits: MapExit[]): GameMap {
  return {
    id: row.id,
    name: row.name,
    width: row.width,
    height: row.height,
    tiles: JSON.parse(row.tiles) as TileKind[],
    spawn: { x: row.spawnX, y: row.spawnY },
    exits,
  };
}

/** The ways out of a map, in reading order: top row first, left to right. */
function exitsOf(read: Read, mapId: string): MapExit[] {
  return read
    .select()
    .from(mapExits)
    .where(eq(mapExits.mapId, mapId))
    .orderBy(asc(mapExits.y), asc(mapExits.x))
    .all()
    .map((row) => ({
      at: { x: row.x, y: row.y },
      to: { mapId: row.toMapId, position: { x: row.toX, y: row.toY } },
    }));
}

/**
 * Reads a map, for the game.
 *
 * A retired map is not there, as far as the game is concerned. Everything on
 * the player's side reads maps through this function — fetching one, saving a
 * position on one, loading a save — so that is decided once, here. A save that
 * was made on a map since retired then finds no map, and `loadSave` already
 * knows what to do with that.
 */
export function findMap(read: Read, id: string): GameMap | undefined {
  const row = read
    .select()
    .from(maps)
    .where(and(eq(maps.id, id), isNull(maps.retiredAt)))
    .get();
  return row === undefined ? undefined : toGameMap(row, exitsOf(read, id));
}

// ---------------------------------------------------------------------------
// What the admin API reads and writes
// ---------------------------------------------------------------------------

function encounterRowsOf(read: Read, mapId: string): Encounter[] {
  return read
    .select({ speciesId: mapEncounters.speciesId, weight: mapEncounters.weight })
    .from(mapEncounters)
    .where(eq(mapEncounters.mapId, mapId))
    .orderBy(asc(mapEncounters.speciesId))
    .all();
}

/**
 * A map with who turns up on it — the shape the admin screen edits. Retired
 * maps included, with the mark: an admin has to be able to see one to bring it
 * back.
 */
export function findAdminMap(read: Read, id: string): AdminMap | undefined {
  const row = read.select().from(maps).where(eq(maps.id, id)).get();
  if (row === undefined) return undefined;
  return {
    ...toGameMap(row, exitsOf(read, id)),
    encounters: encounterRowsOf(read, id),
    retired: row.retiredAt !== null,
  };
}

/** An exit on some other map that arrives on this one: where from, and where it lands. */
export interface IncomingExit {
  from: MasterReference;
  lands: Position;
}

/**
 * Every exit that leads onto a map from a different map — from maps in use
 * and retired ones alike.
 *
 * Asked before a map is redrawn. An exit always arrives on a tile that can be
 * stood on; drawing a tree over that tile would break an exit that lives in
 * another map's data. Retired maps count too, so that bringing one back never
 * has to ask this question again.
 */
export function exitsInto(read: Read, mapId: string): IncomingExit[] {
  return read
    .select({ id: maps.id, name: maps.name, toX: mapExits.toX, toY: mapExits.toY })
    .from(mapExits)
    .innerJoin(maps, eq(mapExits.mapId, maps.id))
    .where(and(eq(mapExits.toMapId, mapId), ne(mapExits.mapId, mapId)))
    .orderBy(asc(maps.name), asc(maps.id), asc(mapExits.y), asc(mapExits.x))
    .all()
    .map((row) => ({
      from: { kind: "map", id: row.id, name: row.name },
      lands: { x: row.toX, y: row.toY },
    }));
}

export function listMaps(read: Read): AdminMap[] {
  const ids = read.select({ id: maps.id }).from(maps).orderBy(asc(maps.name), asc(maps.id)).all();

  const all: AdminMap[] = [];
  for (const { id } of ids) {
    const found = findAdminMap(read, id);
    if (found !== undefined) all.push(found);
  }
  return all;
}

/**
 * Creates or replaces a map together with its encounters and its exits, in one
 * transaction, for the same reason a species is saved with its moves: they are
 * edited as one thing. Both lists are replaced, so leaving a species or an exit
 * out is how it goes away.
 */
export function saveMap(db: Db, id: string, input: MapInput): void {
  const row = {
    name: input.name,
    width: input.width,
    height: input.height,
    tiles: JSON.stringify(input.tiles),
    spawnX: input.spawn.x,
    spawnY: input.spawn.y,
  };
  db.transaction((tx) => {
    tx.insert(maps)
      .values({ id, ...row })
      .onConflictDoUpdate({ target: maps.id, set: row })
      .run();
    tx.delete(mapEncounters).where(eq(mapEncounters.mapId, id)).run();
    for (const { speciesId, weight } of input.encounters) {
      tx.insert(mapEncounters).values({ mapId: id, speciesId, weight }).run();
    }
    // Only the exits that leave this map. Exits that arrive here belong to
    // the maps they leave from.
    tx.delete(mapExits).where(eq(mapExits.mapId, id)).run();
    for (const { at, to } of input.exits) {
      tx.insert(mapExits)
        .values({
          mapId: id,
          x: at.x,
          y: at.y,
          toMapId: to.mapId,
          toX: to.position.x,
          toY: to.position.y,
        })
        .run();
    }
  });
}

// ---------------------------------------------------------------------------
// The starter map
// ---------------------------------------------------------------------------

const LEGEND: Record<string, TileKind> = { ".": "path", g: "grass", T: "tree", w: "water" };

/** Marks where a new player starts. The tile underneath is a path. */
const SPAWN = "@";

/**
 * Drawn as text so that a change to the map is readable in a diff: one string
 * per row, one character per tile. The border of trees is not required — the
 * edge of the map stops a player too — it just looks finished.
 */
const STARTER_ART = [
  "TTTTTTTTTTTTTTTT",
  "T@...gggg..wwwwT",
  "T.TT.gggg..wwwwT",
  "T.TT.......wwwwT",
  "T......TT......T",
  "Tggg...TT...gggT",
  "Tggg........gggT",
  "T....www.......T",
  "T.TT.www..TTT..T",
  "T.TT......TTT..T",
  "T..............T",
  "TTTTTTTTTTTTTTTT",
];

export type MapArtError =
  | { kind: "ragged_row"; row: number }
  | { kind: "unknown_tile"; row: number; char: string }
  /** There must be exactly one spawn marker. */
  | { kind: "spawn_count"; got: number };

/** Turns drawn rows into a map. Everything that can be wrong with a drawing is an error value. */
export function mapFromArt(
  id: string,
  name: string,
  rows: readonly string[],
): Result<GameMap, MapArtError> {
  const width = rows[0]?.length ?? 0;
  const tiles: TileKind[] = [];
  const spawns: Position[] = [];

  for (const [y, row] of rows.entries()) {
    if (row.length !== width) return err({ kind: "ragged_row", row: y });
    for (const [x, char] of [...row].entries()) {
      if (char === SPAWN) {
        spawns.push({ x, y });
        tiles.push("path");
        continue;
      }
      const kind = LEGEND[char];
      if (kind === undefined) return err({ kind: "unknown_tile", row: y, char });
      tiles.push(kind);
    }
  }

  const spawn = spawns[0];
  if (spawn === undefined || spawns.length !== 1) {
    return err({ kind: "spawn_count", got: spawns.length });
  }
  // A drawing has no way of saying where an exit leads. Exits are added from
  // the admin screen.
  return ok({ id, name, width, height: rows.length, tiles, spawn, exits: [] });
}

export function starterMap(): Result<GameMap, MapArtError> {
  return mapFromArt(START_MAP_ID, "はじまりの草原", STARTER_ART);
}

/**
 * Makes sure the starter map's row exists. Runs on every boot and never
 * overwrites: once the admin screen can edit this map, the edited row is the
 * truth, and the drawing above is only where it began.
 */
export function ensureStarterMap(db: Db): Result<void, MapArtError> {
  const map = starterMap();
  if (!map.ok) return map;

  const { id, name, width, height, tiles, spawn } = map.value;
  db.insert(maps)
    .values({
      id,
      name,
      width,
      height,
      tiles: JSON.stringify(tiles),
      spawnX: spawn.x,
      spawnY: spawn.y,
    })
    .onConflictDoNothing()
    .run();
  return ok(undefined);
}
