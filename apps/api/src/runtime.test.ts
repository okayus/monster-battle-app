import { describe, expect, it } from "vitest";

import { err, ok } from "@mba/core";
import type {
  Checked,
  FinishedBattle,
  MoveInput,
  OngoingBattle,
  Result,
  SaveData,
  SpeciesInput,
} from "@mba/core";
import { saves } from "@mba/db";
import type { Appearance, Parsed, Skin } from "@mba/sprite";

import { LOCAL_USER_ID } from "./auth.js";
import type { UserId } from "./auth.js";
import { resolved } from "./changes.js";
import type { Change } from "./changes.js";
import { START_MAP_ID } from "./maps.js";
import { createRuntime, unchanged } from "./runtime.js";
import type { Decision, Runtime, Sources, World } from "./runtime.js";
import { savePosition } from "./saves.js";
import { skinRow } from "./skins.js";
import { firstTile, setup, starter } from "./testing.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A moment with no milliseconds: SQLite keeps timestamps to the second. */
const THEN = new Date("2026-01-02T03:04:05Z");

function runtimeOver(sources: Partial<Sources> = {}) {
  const { db } = setup();
  const runtime = createRuntime(db, {
    random: sources.random ?? (() => 0.5),
    now: sources.now ?? (() => THEN),
    newId: sources.newId ?? (() => "an-id"),
  });
  return { db, runtime };
}

const ON_GRASS: SaveData = { mapId: START_MAP_ID, position: firstTile("grass") };
const AT_SPAWN: SaveData = { mapId: START_MAP_ID, position: starter().spawn };

function placed(at: SaveData): Change {
  return { kind: "player_placed", userId: LOCAL_USER_ID, at };
}

// ---------------------------------------------------------------------------

describe("perform", () => {
  it("writes what was decided, stamps it with the app's clock, and hands back the answer", () => {
    const { db, runtime } = runtimeOver();

    const done = runtime.perform(() => ok({ answer: "moved", changes: [placed(ON_GRASS)] }));

    expect(done).toEqual({ ok: true, value: "moved" });
    expect(db.select().from(saves).all()).toEqual([
      {
        userId: LOCAL_USER_ID,
        mapId: START_MAP_ID,
        x: ON_GRASS.position.x,
        y: ON_GRASS.position.y,
        updatedAt: THEN,
      },
    ]);
  });

  it("writes the changes in the order they were decided", () => {
    const { db, runtime } = runtimeOver();
    // One row per player, so the later of two placements is the one that stays.
    runtime.perform(() => ok({ answer: null, changes: [placed(AT_SPAWN), placed(ON_GRASS)] }));
    expect(db.select({ x: saves.x, y: saves.y }).from(saves).all()).toEqual([ON_GRASS.position]);
  });

  it("writes nothing when the decision refuses, and hands back the refusal", () => {
    const { db, runtime } = runtimeOver();

    const done = runtime.perform(
      (): Result<Decision<string>, { kind: "no" }> => err({ kind: "no" }),
    );

    expect(done).toEqual({ ok: false, error: { kind: "no" } });
    expect(db.select().from(saves).all()).toEqual([]);
  });

  it("writes nothing for a decision that found everything already true", () => {
    const { db, runtime } = runtimeOver();
    expect(runtime.perform(() => ok(unchanged("as it was")))).toEqual({
      ok: true,
      value: "as it was",
    });
    expect(db.select().from(saves).all()).toEqual([]);
  });

  it("writes all of a decision or none of it", () => {
    const { db, runtime } = runtimeOver();

    // The second change cannot be written: there is no such map, and the
    // foreign key says so. The first one, which could, must not stay behind.
    const nowhere: SaveData = { mapId: "no-such-map", position: { x: 0, y: 0 } };
    expect(() =>
      runtime.perform(() => ok({ answer: null, changes: [placed(ON_GRASS), placed(nowhere)] })),
    ).toThrow();

    expect(db.select().from(saves).all()).toEqual([]);
  });

  it("lets the decision read what the database holds", () => {
    const { runtime } = runtimeOver();
    runtime.perform(() => ok({ answer: null, changes: [placed(ON_GRASS)] }));

    const seen = runtime.perform(({ read }) => ok(unchanged(read.select().from(saves).all())));
    expect(seen.ok && seen.value.map((row) => ({ x: row.x, y: row.y }))).toEqual([
      ON_GRASS.position,
    ]);
  });

  it("hands the decision the app's own rolls and ids, drawn only when asked for", () => {
    let drawn = 0;
    const { runtime } = runtimeOver({
      random: () => {
        drawn += 1;
        return 0.25;
      },
      newId: () => "the-next-id",
    });

    runtime.perform(() => ok(unchanged(null)));
    expect(drawn).toBe(0);

    const used = runtime.perform(({ roll, newId }) => ok(unchanged([roll(), roll(), newId()])));
    expect(used).toEqual({ ok: true, value: [0.25, 0.25, "the-next-id"] });
    expect(drawn).toBe(2);
  });
});

describe("a decision", () => {
  it("says what it would change as a value, and changes nothing itself", () => {
    const { db } = setup();

    const decided = savePosition({ read: db }, LOCAL_USER_ID, ON_GRASS);

    expect(decided).toEqual({
      ok: true,
      value: {
        answer: ON_GRASS,
        changes: [{ kind: "player_placed", userId: LOCAL_USER_ID, at: ON_GRASS }],
      },
    });
    expect(db.select().from(saves).all()).toEqual([]);
  });
});

describe("what the types refuse", () => {
  // Nothing in this function runs. It is here to be type-checked: `tsc` fails
  // on a `@ts-expect-error` that has nothing to suppress, so each directive
  // below is a test that the line under it does not compile. Take one of the
  // rules away — give `Read` an `insert`, let a user id be any string — and
  // the build stops here.
  const attempts = (
    runtime: Runtime,
    world: World,
    userId: UserId,
    going: OngoingBattle,
    over: FinishedBattle,
    drawn: { byHand: Skin; parsed: Parsed<Skin> },
    recipe: Parsed<Appearance>,
    master: { move: MoveInput; species: Checked<SpeciesInput>; unchecked: SpeciesInput },
  ): void => {
    // @ts-expect-error — a route is handed `read`, and there is nothing on it to write with
    runtime.read.insert(saves);
    // @ts-expect-error — nor is there on the one a decision is handed
    world.read.update(saves);
    // @ts-expect-error — and nothing to delete with either
    world.read.delete(saves);

    // @ts-expect-error — whose save this is cannot be a string that came from somewhere
    savePosition(world, "local", ON_GRASS);
    savePosition(world, userId, ON_GRASS);

    // @ts-expect-error — a change is one of the kinds `commit` knows how to write
    const unknown: Change = { kind: "player_teleported", userId, at: ON_GRASS };

    const begun: Change = { kind: "battle_begun", id: "b", userId, monsterId: "m", state: going };
    // @ts-expect-error — and a battle cannot begin already over
    const ended: Change = { kind: "battle_begun", id: "b", userId, monsterId: "m", state: over };

    // @ts-expect-error — a skin becomes a row only if it came out of parseSkin
    skinRow("a-skin", userId, drawn.byHand, THEN);
    skinRow("a-skin", userId, drawn.parsed, THEN);
    const unparsed: Change = {
      kind: "skin_drawn",
      id: "a-skin",
      ownerId: userId,
      // @ts-expect-error — and only as a change if it did
      skin: drawn.byHand,
    };

    // @ts-expect-error — a recipe that was parsed has still to have what it names looked up
    const unresolved: Change = { kind: "look_chosen", userId, appearance: recipe };

    // @ts-expect-error — a move that has the shape of one has still to pass the rules
    const unchecked: Change = { kind: "move_saved", id: "a-move", input: master.move };
    // @ts-expect-error — a species that passed them has still to have what it names looked up
    const dangling: Change = { kind: "species_saved", id: "a-kind", input: master.species };

    const kept: Change = { kind: "species_saved", id: "a-kind", input: resolved(master.species) };
    // @ts-expect-error — and looking things up does not make up for a check that was skipped
    const smuggled: Change = { kind: "species_saved", id: "k", input: resolved(master.unchecked) };

    return void [unknown, begun, ended, unparsed, unresolved, unchecked, dangling, kept, smuggled];
  };

  it("is checked by tsc, where a directive with nothing to suppress is an error", () => {
    expect(attempts).toBeTypeOf("function");
  });
});
