/**
 * Pure domain logic — no I/O, no framework, no DOM. Shared by the API and the
 * browser so that a move or a battle resolves identically on both sides.
 *
 * Convention (same as the rest of this workspace): no hand-written `class`
 * declarations, and fallible functions return a `Result` value instead of
 * throwing, so failures stay values you can pattern-match.
 *
 * See docs/01-architecture.md for why this package may not import anything.
 */

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Maps and movement
// ---------------------------------------------------------------------------

/**
 * Tile kinds a map is built from. The names themselves are the stored tile
 * ids: a map holds these strings, not numbers that would only mean something
 * next to this array (and would silently change meaning if it were reordered).
 */
export const TILE_KINDS = ["path", "grass", "tree", "water"] as const;
export type TileKind = (typeof TILE_KINDS)[number];

/**
 * Whether each kind can be walked on. Derived from the kind, never stored: a
 * map that could mark one particular tree as walkable would need rules of its
 * own to keep that sane.
 *
 * A Record rather than a list of walkable kinds, so that adding a kind without
 * deciding this is a type error.
 */
const WALKABLE: Record<TileKind, boolean> = {
  path: true,
  grass: true,
  tree: false,
  water: false,
};

export function isWalkable(kind: TileKind): boolean {
  return WALKABLE[kind];
}

export interface Position {
  x: number;
  y: number;
}

export type Direction = "up" | "down" | "left" | "right";

/** One step in each direction. y grows downwards, like rows on a screen. */
const DELTAS: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * The grid that the movement rules read.
 *
 * `tiles` is flat and row-major: `width * height` entries, with the tile at
 * (x, y) stored at `tiles[y * width + x]`.
 *
 * Flat rather than an array of rows, because rows can disagree about their
 * length and a flat array cannot. With `width` stated once, a ragged map has
 * no way to be written down.
 */
export interface TileMap {
  width: number;
  height: number;
  tiles: readonly TileKind[];
}

/** Master data for one map: the grid, plus what it takes to put a player on it. */
export interface GameMap extends TileMap {
  id: string;
  name: string;
  /** Where a player with no save starts. Always a tile that can be stood on. */
  spawn: Position;
}

/** Where a player is. This is what `/api/save` reads and writes. */
export interface SaveData {
  mapId: string;
  position: Position;
}

/**
 * The tile at a position, or undefined if the position is not on the map.
 *
 * The bounds check is what keeps a flat array honest. Without it, x = width
 * would quietly read the first tile of the next row, and a player could walk
 * off the right edge and reappear on the left.
 */
export function tileAt(map: TileMap, at: Position): TileKind | undefined {
  if (!Number.isInteger(at.x) || !Number.isInteger(at.y)) return undefined;
  if (at.x < 0 || at.y < 0 || at.x >= map.width || at.y >= map.height) return undefined;
  return map.tiles[at.y * map.width + at.x];
}

/**
 * Whether a player may be at this position: it is on the map, and the tile
 * there is walkable. The API asks this before it stores a position, and
 * `step` asks it before it moves — the same rule, which is the point of
 * keeping it here.
 */
export function canStandOn(map: TileMap, at: Position): boolean {
  const kind = tileAt(map, at);
  return kind !== undefined && isWalkable(kind);
}

/**
 * Applies one step of movement. Returns the new position, or `from` itself —
 * the same object — when the way is blocked by a tile or by the edge of the
 * map, so a caller can tell "did not move" with `===`.
 */
export function step(from: Position, dir: Direction, map: TileMap): Position {
  const delta = DELTAS[dir];
  const to = { x: from.x + delta.x, y: from.y + delta.y };
  return canStandOn(map, to) ? to : from;
}

// ---------------------------------------------------------------------------
// Monsters and battle (master data lives in the DB; these are the runtime shapes)
// ---------------------------------------------------------------------------

export interface Move {
  id: string;
  name: string;
  power: number;
}

/** Immutable master data for a monster kind. */
export interface Species {
  id: string;
  name: string;
  maxHp: number;
  attack: number;
  defense: number;
  moveIds: string[];
  /** Which skin to draw. The art itself is never part of master data. */
  skinId: string;
}

/** A monster a player owns: master data plus the mutable per-instance state. */
export interface OwnedMonster {
  id: string;
  species: Species;
  nickname: string | null;
  level: number;
  hp: number;
}

// ---------------------------------------------------------------------------
// To implement (see docs/05-roadmap.md)
// ---------------------------------------------------------------------------

export type DomainError = { kind: "not_implemented" };

/** Damage for one attack. Pure: any randomness is passed in, never drawn here. */
export function calcDamage(
  _attacker: OwnedMonster,
  _defender: OwnedMonster,
  _move: Move,
  _variance: number,
): number {
  throw new Error("not implemented — see docs/05-roadmap.md");
}
