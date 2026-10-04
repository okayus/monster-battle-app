/**
 * Master data, as an admin sends it: deciding whether a move, a species or a
 * map may be stored.
 *
 * Each arrives having passed one check already: it has the shape of one
 * (http.ts). Two more follow, each only if the one before passed — the game's
 * rules (`@mba/core`), then whether what it refers to is there to be referred
 * to (docs/04-api-design.md). The types keep count. `checkSpecies` hands back
 * a `Checked<SpeciesInput>`; the lookups here turn that into a
 * `Resolved<Checked<SpeciesInput>>`; and that is the only thing the change
 * that stores a species will take. A species that skipped a check cannot be
 * written down as a change at all.
 *
 * The ids are the server's to choose. A body that carries one is ignored: POST
 * hands them out, and PUT replaces what is already there and never creates —
 * so there is no way to make a row with an id of one's choosing.
 *
 * Whether something is retired is not part of what is stored here. Editing
 * leaves that as it was; retiring is a request of its own (retirement.ts).
 */

import { canStandOn, checkMap, checkMove, checkSpecies, err, ok } from "@mba/core";
import type {
  Checked,
  MapError,
  MapExit,
  MapInput,
  MasterReference,
  MoveError,
  MoveInput,
  Result,
  SpeciesError,
  SpeciesInput,
} from "@mba/core";
import type { Read } from "@mba/db";

import { resolved } from "./changes.js";
import type { Resolved } from "./changes.js";
import type { BodyError } from "./http.js";
import { exitsInto, findAdminMap } from "./maps.js";
import { firstUnusable, livenessOf } from "./retirement.js";
import type { Decision, World } from "./runtime.js";

/** What a PUT can be refused for before the thing itself is looked at. */
type NotThere = { kind: "not_found" } | BodyError;

/** A row to be stored, under an id. */
type Saved = Decision<{ id: string }>;

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

/** A new move. A move refers to nothing, so there is no third check. */
export function createMove(
  { newId }: Pick<World, "newId">,
  input: MoveInput,
): Result<Saved, MoveError> {
  const checked = checkMove(input);
  if (!checked.ok) return checked;

  const id = newId();
  return ok({ answer: { id }, changes: [{ kind: "move_saved", id, input: checked.value }] });
}

/**
 * Replaces a move.
 *
 * The body comes as it was read, good or bad, because which refusal comes
 * first is part of the decision: a move that is not there is "not found"
 * whatever was sent to replace it.
 */
export function replaceMove(
  { read }: Pick<World, "read">,
  id: string,
  body: Result<MoveInput, BodyError>,
): Result<Saved, NotThere | MoveError> {
  if (livenessOf(read, "moves", id) === "missing") return err({ kind: "not_found" });
  if (!body.ok) return body;

  const checked = checkMove(body.value);
  if (!checked.ok) return checked;
  return ok({ answer: { id }, changes: [{ kind: "move_saved", id, input: checked.value }] });
}

// ---------------------------------------------------------------------------
// Species
// ---------------------------------------------------------------------------

export type SpeciesRefusal =
  | SpeciesError
  /** The thing referred to does not exist … */
  | { kind: "unknown_skin"; skinId: string }
  | { kind: "unknown_move"; moveId: string }
  /** … or it does, and has been retired: nothing new may point at it. */
  | { kind: "retired_skin"; skinId: string }
  | { kind: "retired_move"; moveId: string };

/** The rules, then the references: a species that is safe to store, or why it is not. */
function acceptSpecies(
  read: Read,
  input: SpeciesInput,
): Result<Resolved<Checked<SpeciesInput>>, SpeciesRefusal> {
  const checked = checkSpecies(input);
  if (!checked.ok) return checked;

  // The database would refuse a missing one too (foreign keys), but by
  // throwing. Asking first turns "that skin does not exist" into an answer.
  // A retired one the database would accept; refusing it is this API's rule.
  const skin = firstUnusable(read, "skins", [input.skinId]);
  if (skin !== undefined) {
    return err({ kind: skin.why === "missing" ? "unknown_skin" : "retired_skin", skinId: skin.id });
  }
  const move = firstUnusable(read, "moves", input.moveIds);
  if (move !== undefined) {
    return err({ kind: move.why === "missing" ? "unknown_move" : "retired_move", moveId: move.id });
  }

  // Everything it names has been looked up. This is the line that says so.
  return ok(resolved(checked.value));
}

export function createSpecies(
  { read, newId }: Pick<World, "read" | "newId">,
  input: SpeciesInput,
): Result<Saved, SpeciesRefusal> {
  const accepted = acceptSpecies(read, input);
  if (!accepted.ok) return accepted;

  const id = newId();
  return ok({ answer: { id }, changes: [{ kind: "species_saved", id, input: accepted.value }] });
}

/** Replaces a species together with the moves it knows. As with a move, "not found" comes first. */
export function replaceSpecies(
  { read }: Pick<World, "read">,
  id: string,
  body: Result<SpeciesInput, BodyError>,
): Result<Saved, NotThere | SpeciesRefusal> {
  if (livenessOf(read, "species", id) === "missing") return err({ kind: "not_found" });
  if (!body.ok) return body;

  const accepted = acceptSpecies(read, body.value);
  if (!accepted.ok) return accepted;
  return ok({ answer: { id }, changes: [{ kind: "species_saved", id, input: accepted.value }] });
}

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

export type MapRefusal =
  | MapError
  | { kind: "unknown_species"; speciesId: string }
  | { kind: "retired_species"; speciesId: string }
  | { kind: "unknown_map"; mapId: string }
  | { kind: "retired_map"; mapId: string }
  /** An exit has to arrive on a tile of the other map that can be stood on. */
  | { kind: "bad_exit_destination"; exit: MapExit }
  /** Redrawing this map would put something unwalkable where another map's exit arrives. */
  | { kind: "blocks_exit"; by: MasterReference[] };

/**
 * The rules, then the references. `id` is the map being replaced, or
 * undefined for one that is being created. It matters for exits, which are
 * the one thing in a map that can refer to the map itself — and to which
 * other maps refer.
 */
function acceptMap(
  read: Read,
  input: MapInput,
  id?: string,
): Result<Resolved<Checked<MapInput>>, MapRefusal> {
  const checked = checkMap(input);
  if (!checked.ok) return checked;

  const kind = firstUnusable(
    read,
    "species",
    input.encounters.map((encounter) => encounter.speciesId),
  );
  if (kind !== undefined) {
    return err({
      kind: kind.why === "missing" ? "unknown_species" : "retired_species",
      speciesId: kind.id,
    });
  }

  // Where the exits lead. An exit back onto this same map is judged against
  // the tiles being saved, not the ones in the database.
  const elsewhere = input.exits.filter((exit) => exit.to.mapId !== id);
  const target = firstUnusable(
    read,
    "maps",
    elsewhere.map((exit) => exit.to.mapId),
  );
  if (target !== undefined) {
    return err({
      kind: target.why === "missing" ? "unknown_map" : "retired_map",
      mapId: target.id,
    });
  }
  for (const exit of input.exits) {
    const far = exit.to.mapId === id ? input : findAdminMap(read, exit.to.mapId);
    if (far === undefined || !canStandOn(far, exit.to.position)) {
      return err({ kind: "bad_exit_destination", exit });
    }
  }

  // And the exits that lead here, from other maps. They live in those maps'
  // data, so this edit cannot fix them — it can only not break them.
  if (id !== undefined) {
    const blocked = exitsInto(read, id).filter((exit) => !canStandOn(input, exit.lands));
    if (blocked.length > 0) {
      const by = new Map(blocked.map((exit) => [exit.from.id, exit.from]));
      return err({ kind: "blocks_exit", by: [...by.values()] });
    }
  }

  // Everything it names has been looked up. This is the line that says so.
  return ok(resolved(checked.value));
}

export function createMap(
  { read, newId }: Pick<World, "read" | "newId">,
  input: MapInput,
): Result<Saved, MapRefusal> {
  const accepted = acceptMap(read, input);
  if (!accepted.ok) return accepted;

  const id = newId();
  return ok({ answer: { id }, changes: [{ kind: "map_saved", id, input: accepted.value }] });
}

/** Replaces a map together with who turns up on it and its exits. "Not found" comes first. */
export function replaceMap(
  { read }: Pick<World, "read">,
  id: string,
  body: Result<MapInput, BodyError>,
): Result<Saved, NotThere | MapRefusal> {
  if (findAdminMap(read, id) === undefined) return err({ kind: "not_found" });
  if (!body.ok) return body;

  const accepted = acceptMap(read, body.value, id);
  if (!accepted.ok) return accepted;
  return ok({ answer: { id }, changes: [{ kind: "map_saved", id, input: accepted.value }] });
}
