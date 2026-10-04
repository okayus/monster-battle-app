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

import type { BeginError, TurnError } from "./battles.js";
import type { BodyError } from "./http.js";
import type { SaveError, TravelError } from "./saves.js";

export type Refusal =
  | BodyError
  | { kind: "body_too_large"; max: number }
  | { kind: "not_found" }
  | SaveError
  | TravelError
  | BeginError
  | TurnError;

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
} as const satisfies Record<Refusal["kind"], Status>;

/** Answers with an error: the value as it is, under the status its kind has. */
export function refuse(c: Context, error: Refusal) {
  return c.json({ error }, STATUS[error.kind]);
}
