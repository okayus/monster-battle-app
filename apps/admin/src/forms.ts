/**
 * The state behind the two edit forms, and how it becomes what the API is sent.
 *
 * Pure, and kept apart from the components so it can be tested against the
 * real rules (`checkSpecies`, `checkMap`). A form and the validator have to
 * agree, and the cheapest place to find out that they do not is a unit test.
 *
 * Nothing in here is a defence. Where a helper refuses an edit — a wall on the
 * spawn tile, say — it is sparing the admin a 400, not replacing the check the
 * server makes.
 */

import { canStandOn, isWalkable } from "@mba/core";
import type { AdminMap, MapInput, Position, Species, SpeciesInput, TileKind } from "@mba/core";

// ---------------------------------------------------------------------------
// Species
// ---------------------------------------------------------------------------

export interface SpeciesForm {
  /** Null while the species has not been saved yet. */
  id: string | null;
  name: string;
  maxHp: number;
  attack: number;
  defense: number;
  skinId: string;
  moveIds: string[];
}

export function blankSpeciesForm(skinId: string): SpeciesForm {
  return { id: null, name: "", maxHp: 20, attack: 10, defense: 10, skinId, moveIds: [] };
}

export function speciesFormOf(species: Species): SpeciesForm {
  return {
    id: species.id,
    name: species.name,
    maxHp: species.maxHp,
    attack: species.attack,
    defense: species.defense,
    skinId: species.skinId,
    moveIds: species.moves.map((move) => move.id),
  };
}

export function toSpeciesInput(form: SpeciesForm): SpeciesInput {
  return {
    name: form.name.trim(),
    maxHp: form.maxHp,
    attack: form.attack,
    defense: form.defense,
    skinId: form.skinId,
    moveIds: form.moveIds,
  };
}

/** Ticks or unticks one move. */
export function toggleMove(form: SpeciesForm, moveId: string): SpeciesForm {
  const moveIds = form.moveIds.includes(moveId)
    ? form.moveIds.filter((id) => id !== moveId)
    : [...form.moveIds, moveId];
  return { ...form, moveIds };
}

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

export interface MapForm {
  /** Null while the map has not been saved yet. */
  id: string | null;
  name: string;
  width: number;
  height: number;
  tiles: TileKind[];
  spawn: Position;
  /**
   * Encounter weight per species id. A species with no entry, or a weight of
   * zero, does not turn up — the form shows every species, the map only stores
   * the ones that do.
   */
  weights: Record<string, number>;
}

/** The size a new map starts at. The API accepts others; this screen does not resize. */
const NEW_MAP = { width: 16, height: 12 } as const;

export function blankMapForm(): MapForm {
  return {
    id: null,
    name: "",
    width: NEW_MAP.width,
    height: NEW_MAP.height,
    tiles: new Array<TileKind>(NEW_MAP.width * NEW_MAP.height).fill("path"),
    spawn: { x: 0, y: 0 },
    weights: {},
  };
}

export function mapFormOf(map: AdminMap): MapForm {
  const weights: Record<string, number> = {};
  for (const { speciesId, weight } of map.encounters) weights[speciesId] = weight;
  return {
    id: map.id,
    name: map.name,
    width: map.width,
    height: map.height,
    tiles: [...map.tiles],
    spawn: map.spawn,
    weights,
  };
}

export function toMapInput(form: MapForm): MapInput {
  return {
    name: form.name.trim(),
    width: form.width,
    height: form.height,
    tiles: form.tiles,
    spawn: form.spawn,
    encounters: Object.entries(form.weights)
      .filter(([, weight]) => weight > 0)
      .map(([speciesId, weight]) => ({ speciesId, weight }))
      // A fixed order, so the same form always sends the same body.
      .sort((a, b) => a.speciesId.localeCompare(b.speciesId)),
  };
}

function indexOf(form: MapForm, at: Position): number {
  return at.y * form.width + at.x;
}

/**
 * Paints one tile. Returns the same form when nothing changes, so a drag over
 * tiles that already have the brush's kind does not re-render anything.
 *
 * The spawn tile only takes kinds a player can stand on: the server would
 * refuse the map otherwise, and the place to learn that is here, while
 * painting, not after pressing save.
 */
export function paintTile(form: MapForm, index: number, kind: TileKind): MapForm {
  if (index < 0 || index >= form.tiles.length) return form;
  if (form.tiles[index] === kind) return form;
  if (index === indexOf(form, form.spawn) && !isWalkable(kind)) return form;

  const tiles = form.tiles.slice();
  tiles[index] = kind;
  return { ...form, tiles };
}

/** Moves the spawn to a tile, if a player could stand there. */
export function moveSpawn(form: MapForm, index: number): MapForm {
  const at = { x: index % form.width, y: Math.floor(index / form.width) };
  if (index < 0 || index >= form.tiles.length || !canStandOn(form, at)) return form;
  if (index === indexOf(form, form.spawn)) return form;
  return { ...form, spawn: at };
}

/** Sets one species' weight. Anything that is not a positive number means "does not turn up". */
export function setWeight(form: MapForm, speciesId: string, weight: number): MapForm {
  return { ...form, weights: { ...form.weights, [speciesId]: weight > 0 ? weight : 0 } };
}
