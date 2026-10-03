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
// Randomness
//
// Nothing in this package draws a random number. Every function that needs one
// takes it as an argument — a "roll" in [0, 1), the range Math.random() gives —
// and the caller decides where it comes from. On the server that is the real
// generator; in a test it is whatever number makes the case under test happen.
// ---------------------------------------------------------------------------

/**
 * Pulls a roll back into [0, 1]. A roll from outside that range (or NaN) can
 * then skew a result, but it cannot break one.
 */
function clamp01(roll: number): number {
  if (!(roll > 0)) return 0; // also catches NaN
  return roll > 1 ? 1 : roll;
}

/** Picks one of `items`, each equally likely. Undefined only when there are none. */
function pick<T>(items: readonly T[], roll: number): T | undefined {
  const index = Math.floor(clamp01(roll) * items.length);
  return items[Math.min(items.length - 1, index)];
}

export interface Weighted<T> {
  value: T;
  weight: number;
}

/**
 * Picks one entry, each with a chance proportional to its weight. Entries with
 * no weight (zero, negative, not a number) are never picked; undefined when
 * that leaves nothing to pick from.
 */
export function pickWeighted<T>(entries: readonly Weighted<T>[], roll: number): T | undefined {
  const weightOf = (entry: Weighted<T>) =>
    Number.isFinite(entry.weight) && entry.weight > 0 ? entry.weight : 0;

  let total = 0;
  for (const entry of entries) total += weightOf(entry);
  if (total === 0) return undefined;

  // Lay every weight end to end; the roll is a point on that line.
  let remaining = clamp01(roll) * total;
  let last: T | undefined;
  for (const entry of entries) {
    const weight = weightOf(entry);
    if (weight === 0) continue;
    if (remaining < weight) return entry.value;
    remaining -= weight;
    last = entry.value;
  }
  // The very end of the line (a roll of exactly 1) belongs to the last entry.
  return last;
}

// ---------------------------------------------------------------------------
// Encounters
// ---------------------------------------------------------------------------

/**
 * Whether wild monsters live on each kind of tile. Like walkability, this is
 * derived from the kind and not stored on the map, so the same tile array
 * answers "what is drawn here", "can I walk here" and "can I be attacked here".
 */
const WILD: Record<TileKind, boolean> = {
  path: false,
  grass: true,
  tree: false,
  water: false,
};

export function hasWildMonsters(kind: TileKind): boolean {
  return WILD[kind];
}

// ---------------------------------------------------------------------------
// Monsters (master data lives in the DB; these are the runtime shapes)
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
  /** Which skin to draw. The art itself is never part of master data. */
  skinId: string;
  moves: Move[];
}

/** A monster a player owns: a species, and what the player has made of it. */
export interface OwnedMonster {
  id: string;
  species: Species;
  nickname: string | null;
}

// ---------------------------------------------------------------------------
// Battle
// ---------------------------------------------------------------------------

/**
 * One side of a battle.
 *
 * A snapshot, taken when the battle starts: the numbers are copied out of the
 * species instead of referring to it. A battle in progress therefore keeps the
 * stats it began with, even if the master data is edited halfway through.
 */
export interface Combatant {
  name: string;
  skinId: string;
  maxHp: number;
  hp: number;
  attack: number;
  defense: number;
  moves: Move[];
}

/** A fresh combatant at full health. */
export function combatantOf(species: Species, nickname: string | null = null): Combatant {
  return {
    name: nickname ?? species.name,
    skinId: species.skinId,
    maxHp: species.maxHp,
    hp: species.maxHp,
    attack: species.attack,
    defense: species.defense,
    moves: species.moves.map((move) => ({ id: move.id, name: move.name, power: move.power })),
  };
}

/** The weakest a hit can land, as a fraction of the strongest. */
const MIN_SPREAD = 0.85;

/**
 * Damage for one attack.
 *
 * Pure: `variance` is a roll the caller drew. 0 gives the weakest hit (85% of
 * the full damage) and anything just under 1 gives the strongest.
 */
export function calcDamage(
  attacker: Pick<Combatant, "attack">,
  defender: Pick<Combatant, "defense">,
  move: Pick<Move, "power">,
  variance: number,
): number {
  // A defense of zero would divide by zero, so anything below 1 counts as 1.
  const base = (move.power * attacker.attack) / Math.max(1, defender.defense);
  const spread = MIN_SPREAD + (1 - MIN_SPREAD) * clamp01(variance);
  const damage = Math.floor(base * spread);
  // Every hit lands for at least 1, which is what guarantees a battle ends.
  // Written this way round so that NaN, too, comes out as 1.
  return damage >= 1 ? damage : 1;
}

export type Side = "player" | "enemy";

export type BattleStatus = "ongoing" | "won" | "lost";

export interface BattleState {
  /**
   * How many turns have been played. The client sends this back with each
   * move, which is how the server tells a move for *this* turn from the same
   * request arriving twice.
   */
  turn: number;
  status: BattleStatus;
  player: Combatant;
  enemy: Combatant;
}

export function startBattle(player: Combatant, enemy: Combatant): BattleState {
  return { turn: 0, status: "ongoing", player, enemy };
}

/** Every random number one turn can need. Each is a roll in [0, 1). */
export interface TurnRolls {
  /** How hard the player's attack lands. */
  playerVariance: number;
  /** Which of its moves the enemy uses. */
  enemyMove: number;
  /** How hard the enemy's attack lands. */
  enemyVariance: number;
}

/** What happened during a turn, in order. The screen turns these into text. */
export type BattleEvent =
  | { kind: "attack"; by: Side; move: string; damage: number }
  | { kind: "fainted"; who: Side };

export type BattleError = { kind: "battle_over" } | { kind: "unknown_move"; moveId: string };

function hit(target: Combatant, damage: number): Combatant {
  return { ...target, hp: Math.max(0, target.hp - damage) };
}

/**
 * Plays one turn: the player's move, then — if it is still standing — the
 * enemy's reply. Returns a new state; the one passed in is not changed.
 *
 * This is the whole judgement of a battle, and it lives here so that the
 * server can run it. The browser never decides how much damage was done or who
 * won; it sends a move id and is told what happened.
 */
export function playTurn(
  state: BattleState,
  moveId: string,
  rolls: TurnRolls,
): Result<{ state: BattleState; events: BattleEvent[] }, BattleError> {
  if (state.status !== "ongoing") return err({ kind: "battle_over" });

  const move = state.player.moves.find((candidate) => candidate.id === moveId);
  if (move === undefined) return err({ kind: "unknown_move", moveId });

  const turn = state.turn + 1;
  const events: BattleEvent[] = [];

  const dealt = calcDamage(state.player, state.enemy, move, rolls.playerVariance);
  const enemy = hit(state.enemy, dealt);
  events.push({ kind: "attack", by: "player", move: move.name, damage: dealt });
  if (enemy.hp === 0) {
    events.push({ kind: "fainted", who: "enemy" });
    return ok({ state: { turn, status: "won", player: state.player, enemy }, events });
  }

  // An enemy with no moves has nothing to answer with, and the turn just ends.
  const reply = pick(enemy.moves, rolls.enemyMove);
  if (reply === undefined) {
    return ok({ state: { turn, status: "ongoing", player: state.player, enemy }, events });
  }

  const taken = calcDamage(enemy, state.player, reply, rolls.enemyVariance);
  const player = hit(state.player, taken);
  events.push({ kind: "attack", by: "enemy", move: reply.name, damage: taken });
  if (player.hp === 0) {
    events.push({ kind: "fainted", who: "player" });
    return ok({ state: { turn, status: "lost", player, enemy }, events });
  }

  return ok({ state: { turn, status: "ongoing", player, enemy }, events });
}

// ---------------------------------------------------------------------------
// What the browser is shown
// ---------------------------------------------------------------------------

export interface CombatantView {
  name: string;
  skinId: string;
  hp: number;
  maxHp: number;
}

/**
 * A battle as the screen needs it — which is less than the server knows.
 * Attack, defense and the enemy's moves stay behind: nothing on the screen
 * shows them, and what is not sent cannot be read out of a network tab.
 */
export interface BattleView {
  id: string;
  turn: number;
  status: BattleStatus;
  player: CombatantView & { moves: Move[] };
  enemy: CombatantView;
}

function viewCombatant(combatant: Combatant): CombatantView {
  return {
    name: combatant.name,
    skinId: combatant.skinId,
    hp: combatant.hp,
    maxHp: combatant.maxHp,
  };
}

export function viewBattle(id: string, state: BattleState): BattleView {
  return {
    id,
    turn: state.turn,
    status: state.status,
    player: {
      ...viewCombatant(state.player),
      moves: state.player.moves.map((move) => ({
        id: move.id,
        name: move.name,
        power: move.power,
      })),
    },
    enemy: viewCombatant(state.enemy),
  };
}

/** What `POST /api/battles/:id/turn` answers with. */
export interface TurnOutcome {
  battle: BattleView;
  events: BattleEvent[];
}

// ---------------------------------------------------------------------------
// Master data rules
//
// What the admin API asks before it stores a move, a species or a map. The split is
// the one docs/04-api-design.md draws: whether a field is a number at all is
// a question of shape, answered by the API with a schema; whether that number
// makes sense in the game is a rule, and the rules are here, where the admin
// screen can read the same limits it is about to be held to.
// ---------------------------------------------------------------------------

/** True for a name with something in it and no more than `max` characters. */
function isName(name: string, max: number): boolean {
  return name.trim().length > 0 && name.length <= max;
}

function isIntBetween(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export const MOVE_LIMITS = {
  maxNameLength: 32,
  /** Upper bound for a move's power. The lower bound is 1. */
  maxPower: 999,
} as const;

/** What an admin submits for a move. */
export interface MoveInput {
  name: string;
  power: number;
}

export type MoveError = { kind: "bad_name" } | { kind: "bad_power"; power: number };

/** The rules a move has to satisfy. */
export function checkMove(input: MoveInput): Result<MoveInput, MoveError> {
  if (!isName(input.name, MOVE_LIMITS.maxNameLength)) return err({ kind: "bad_name" });
  // A power of zero is not a weak move. Every hit lands for at least 1
  // (`calcDamage`), so it would be a move that does the same whoever uses it
  // on whomever — a number that says nothing.
  if (!isIntBetween(input.power, 1, MOVE_LIMITS.maxPower)) {
    return err({ kind: "bad_power", power: input.power });
  }
  return ok(input);
}

export const SPECIES_LIMITS = {
  maxNameLength: 32,
  /** Upper bound for max HP, attack and defense. The lower bound is 1. */
  maxStat: 999,
  maxMoves: 4,
} as const;

/** What an admin submits for a species. Moves and the skin are named by id. */
export interface SpeciesInput {
  name: string;
  maxHp: number;
  attack: number;
  defense: number;
  skinId: string;
  moveIds: string[];
}

export type SpeciesError =
  | { kind: "bad_name" }
  | { kind: "bad_stat"; stat: "maxHp" | "attack" | "defense"; value: number }
  /** A species needs at least one move, or it has no turn to take. */
  | { kind: "bad_move_count"; got: number }
  | { kind: "duplicate_move"; moveId: string };

/**
 * The rules a species has to satisfy. Whether its skin and moves exist is not
 * decided here: that depends on what is in the database, which this package
 * cannot see.
 */
export function checkSpecies(input: SpeciesInput): Result<SpeciesInput, SpeciesError> {
  if (!isName(input.name, SPECIES_LIMITS.maxNameLength)) return err({ kind: "bad_name" });

  for (const stat of ["maxHp", "attack", "defense"] as const) {
    // A stat of zero is not a weak monster, it is a broken one: zero health
    // has already fainted, and zero defense divides by zero.
    if (!isIntBetween(input[stat], 1, SPECIES_LIMITS.maxStat)) {
      return err({ kind: "bad_stat", stat, value: input[stat] });
    }
  }

  if (input.moveIds.length < 1 || input.moveIds.length > SPECIES_LIMITS.maxMoves) {
    return err({ kind: "bad_move_count", got: input.moveIds.length });
  }
  const seen = new Set<string>();
  for (const moveId of input.moveIds) {
    if (seen.has(moveId)) return err({ kind: "duplicate_move", moveId });
    seen.add(moveId);
  }
  return ok(input);
}

export const MAP_LIMITS = {
  maxNameLength: 32,
  maxWidth: 32,
  maxHeight: 32,
  /** Upper bound for an encounter weight. The lower bound is 1. */
  maxWeight: 100,
} as const;

/** One line of "who turns up on this map": a species and its weight. */
export interface Encounter {
  speciesId: string;
  weight: number;
}

/** What an admin submits for a map. */
export interface MapInput {
  name: string;
  width: number;
  height: number;
  tiles: TileKind[];
  spawn: Position;
  encounters: Encounter[];
}

/** A map as the admin screen edits it: the grid, and who turns up on it. */
export interface AdminMap extends GameMap {
  encounters: Encounter[];
}

export type MapError =
  | { kind: "bad_name" }
  | { kind: "bad_size"; width: number; height: number }
  | { kind: "bad_tile_count"; got: number; expected: number }
  /** The spawn has to be a tile a player can stand on, or a new game starts stuck. */
  | { kind: "bad_spawn"; spawn: Position }
  | { kind: "bad_weight"; speciesId: string; weight: number }
  | { kind: "duplicate_encounter"; speciesId: string };

/**
 * The rules a map has to satisfy. As with species, whether the species it
 * names exist is left to the caller.
 */
export function checkMap(input: MapInput): Result<MapInput, MapError> {
  if (!isName(input.name, MAP_LIMITS.maxNameLength)) return err({ kind: "bad_name" });

  const { width, height } = input;
  if (
    !isIntBetween(width, 1, MAP_LIMITS.maxWidth) ||
    !isIntBetween(height, 1, MAP_LIMITS.maxHeight)
  ) {
    return err({ kind: "bad_size", width, height });
  }
  if (input.tiles.length !== width * height) {
    return err({ kind: "bad_tile_count", got: input.tiles.length, expected: width * height });
  }
  if (!canStandOn(input, input.spawn)) return err({ kind: "bad_spawn", spawn: input.spawn });

  const seen = new Set<string>();
  for (const { speciesId, weight } of input.encounters) {
    if (!isIntBetween(weight, 1, MAP_LIMITS.maxWeight)) {
      return err({ kind: "bad_weight", speciesId, weight });
    }
    if (seen.has(speciesId)) return err({ kind: "duplicate_encounter", speciesId });
    seen.add(speciesId);
  }
  return ok(input);
}

/** A skin, as much of it as a list needs: enough to name it and say whose it is. */
export interface SkinSummary {
  id: string;
  name: string;
  /** Null for the skins that ship with the game. */
  ownerId: string | null;
}

// ---------------------------------------------------------------------------
// Retiring
//
// Master data and skins are never deleted: saves, looks and owned monsters
// refer to them (docs/03-data-model.md). What can be done instead is to
// retire one — it stops being offered, and what already uses it keeps working
// as far as it can. These are the shapes the admin API speaks in.
// ---------------------------------------------------------------------------

/** A move as the admin screens list it. */
export interface AdminMove extends Move {
  retired: boolean;
}

/** A species as the admin screens list it. */
export interface AdminSpecies extends Species {
  retired: boolean;
}

/** Something that stands in the way of retiring or restoring, named so an admin can go and fix it. */
export interface MasterReference {
  kind: "species" | "move" | "map" | "skin";
  id: string;
  name: string;
}

export type RetireError =
  /** Master data that is still in use refers to it. `by` says which. */
  | { kind: "in_use"; by: MasterReference[] }
  /** It cannot come back while it refers to something that is retired. `on` says what. */
  | { kind: "depends_on_retired"; on: MasterReference[] }
  /** The game falls back to this one when something else is retired, so it has to stay. */
  | { kind: "protected" };

/**
 * A skin as a player's wardrobe lists it. Whose it is has been narrowed to the
 * one thing the player asking needs to know: other users' ids stay on the
 * server.
 */
export interface WearableSkin {
  id: string;
  name: string;
  /** True if the player asking drew it. */
  mine: boolean;
}
