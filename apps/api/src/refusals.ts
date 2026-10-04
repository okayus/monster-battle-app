/**
 * Every reason the API gives for saying no, and the status each is said with.
 *
 * A decision refuses with a value — `{ kind: "unreachable", … }` — and knows
 * nothing about HTTP. This file is where that value becomes a response, and
 * it is the only place a status code for an error is written down. The body
 * is always the same shape, `{ "error": { "kind": … } }`, so a client can
 * branch on the kind and choose its own words (docs/04-api-design.md
 * §エラーの返し方).
 *
 * The table is a `Record` over every kind there is. A kind added to one of
 * the error types below and not given a status here is a type error, and so
 * is a decision that refuses with a kind this file has never heard of. The
 * lists of errors in docs/04 are this table, written out for people.
 */

import type { Context } from "hono";

import type { MoveError, RetireError } from "@mba/core";
import type { SkinError } from "@mba/sprite";

import type { LookError } from "./appearance.js";
import type { BeginError, TurnError } from "./battles.js";
import type { BodyError } from "./http.js";
import type { MapRefusal, SpeciesRefusal } from "./master.js";
import type { SaveError, TravelError } from "./saves.js";

export type Refusal =
  | BodyError
  | { kind: "body_too_large"; max: number }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | SaveError
  | TravelError
  | BeginError
  | TurnError
  | SkinError
  | LookError
  | MoveError
  | SpeciesRefusal
  | MapRefusal
  | RetireError;

/**
 * 400 the request is wrong, 403 the caller may not, 404 there is no such
 * thing, 413 the body is too big to read, 500 the fault is on this side.
 */
type Status = 400 | 403 | 404 | 413 | 500;

const STATUS = {
  // The request itself, before it means anything.
  bad_json: 400,
  malformed: 400,
  body_too_large: 413,
  forbidden: 403,
  not_found: 404,

  // Where the player is.
  unknown_map: 400,
  wrong_map: 400,
  cannot_stand: 400,
  unreachable: 400,
  no_exit_here: 400,
  // Not the request's fault: there is no starter map, or an exit leads
  // somewhere nobody can stand. Master data the admin API should have kept
  // from happening.
  no_start_map: 500,
  broken_exit: 500,

  // Battles.
  no_encounters_here: 400,
  no_monster: 400,
  stale_turn: 400,
  battle_over: 400,
  unknown_move: 400,

  // Skins and looks: what `parseSkin` and `parseAppearance` refuse
  // (docs/02-sprite-format.md), and what a recipe may not name.
  too_large: 400,
  too_many: 400,
  bad_cell_count: 400,
  bad_palette_id: 400,
  duplicate_palette_id: 400,
  bad_hex: 400,
  bad_palette_index: 400,
  missing_slot: 400,
  unknown_skin: 400,
  unknown_colour: 400,

  // Master data: the rules it has to satisfy (`checkMove`, `checkSpecies`,
  // `checkMap` in `@mba/core`) …
  bad_name: 400,
  bad_power: 400,
  bad_stat: 400,
  bad_move_count: 400,
  duplicate_move: 400,
  bad_size: 400,
  bad_tile_count: 400,
  bad_spawn: 400,
  bad_weight: 400,
  duplicate_encounter: 400,
  too_many_exits: 400,
  bad_exit: 400,
  duplicate_exit: 400,
  // … what it may refer to …
  unknown_species: 400,
  retired_skin: 400,
  retired_move: 400,
  retired_species: 400,
  retired_map: 400,
  bad_exit_destination: 400,
  blocks_exit: 400,
  // … and what stands in the way of retiring something, or bringing it back.
  in_use: 400,
  depends_on_retired: 400,
  protected: 400,
} as const satisfies Record<Refusal["kind"], Status>;

/** Answers with an error: the value as it is, under the status its kind has. */
export function refuse(c: Context, error: Refusal) {
  return c.json({ error }, STATUS[error.kind]);
}
