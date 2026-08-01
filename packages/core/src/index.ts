/**
 * Pure domain logic — no I/O, no framework, no DOM. Shared by the API and the
 * browser so that a battle resolves identically on both sides.
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
// Domain types (master data lives in the DB; these are the runtime shapes)
// ---------------------------------------------------------------------------

/** Tile kinds a map grid is built from. Walkability is derived, not stored. */
export const TILE_KINDS = ["path", "grass", "tree", "water"] as const;
export type TileKind = (typeof TILE_KINDS)[number];

export interface Position {
  x: number;
  y: number;
}

export type Direction = "up" | "down" | "left" | "right";

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

/** Applies one step of movement, or returns the same position if blocked. */
export function step(_from: Position, _dir: Direction, _grid: TileKind[][]): Position {
  throw new Error("not implemented — see docs/05-roadmap.md");
}

/** Damage for one attack. Pure: any randomness is passed in, never drawn here. */
export function calcDamage(
  _attacker: OwnedMonster,
  _defender: OwnedMonster,
  _move: Move,
  _variance: number,
): number {
  throw new Error("not implemented — see docs/05-roadmap.md");
}
