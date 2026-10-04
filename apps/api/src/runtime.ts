/**
 * How a request that changes something is carried out.
 *
 *   perform = commit ∘ decide ∘ read
 *
 * A *decision* is an ordinary synchronous function. It is given a `World` to
 * ask things of, and it returns a value: either a refusal, or an answer
 * together with the list of changes that make the answer true (changes.ts).
 * It does not write. `perform` runs one and then writes what it decided.
 *
 * Three things the API used to promise in comments follow from this shape,
 * for every decision at once:
 *
 * - **Nothing gets in between the read and the write.** A decision cannot
 *   `await` — it is not an async function — and `perform` does not either.
 *   Node runs one request's handler at a time, so two requests cannot both
 *   decide from the same state. (One process only: see docs/04-api-design.md.)
 * - **All of it is written, or none of it.** The read, the decision and the
 *   writes share one transaction. A write that fails takes the others with it,
 *   and the request can be sent again.
 * - **A refusal writes nothing.** There is no list of changes to commit.
 *
 * What a decision may do is in its signature. One that takes
 * `Pick<World, "read">` can only look; one that also draws a random number or
 * names a new row asks for `roll` or `newId` as well. Reading is free — it is
 * never part of the result — and writing is only ever the result.
 */

import { ok } from "@mba/core";
import type { Result } from "@mba/core";
import type { Db, Read } from "@mba/db";

import { commit } from "./changes.js";
import type { Change } from "./changes.js";

/** What a decision is made with. */
export interface World {
  /** The database, to ask. There is no handle here to write with. */
  read: Read;
  /** A random number in [0, 1). Drawn when called, so a decision that needs none draws none. */
  roll: () => number;
  /** An id for a row that does not exist yet. */
  newId: () => string;
}

/** What a decision comes to: what to tell the caller, and what has to change for that to be true. */
export interface Decision<T> {
  answer: T;
  changes: readonly Change[];
}

/** A decision that changes nothing: the answer is already true. */
export function unchanged<T>(answer: T): Decision<T> {
  return { answer, changes: [] };
}

/**
 * The things that differ from one run to the next. The app is handed them
 * (app.ts), so a test can decide what each of them says.
 */
export interface Sources {
  /** `Math.random` when really running. */
  random: () => number;
  /** The time a change is stamped with. */
  now: () => Date;
  newId: () => string;
}

/** What a route is given: a way to ask, and a way to have a decision carried out. */
export interface Runtime {
  /**
   * For answering a GET. It can only read, so a GET cannot create a row by
   * being asked — not as a convention, but because there is nothing here to
   * create one with.
   */
  read: Read;
  /** Runs a decision and, if it did not refuse, writes what it decided. */
  perform<T, E>(decide: (world: World) => Result<Decision<T>, E>): Result<T, E>;
}

export function createRuntime(db: Db, sources: Sources): Runtime {
  return {
    read: db,
    perform: (decide) =>
      db.transaction((tx) => {
        const decided = decide({ read: tx, roll: sources.random, newId: sources.newId });
        if (!decided.ok) return decided;
        commit(tx, decided.value.changes, sources.now());
        return ok(decided.value.answer);
      }),
  };
}
