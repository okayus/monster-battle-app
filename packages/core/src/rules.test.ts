import { describe, expect, it } from "vitest";

import {
  MAP_LIMITS,
  MOVE_LIMITS,
  SPECIES_LIMITS,
  calcDamage,
  checkMap,
  checkMove,
  checkSpecies,
  exitAt,
} from "./index.js";
import type { Checked, MapInput, MoveInput, SpeciesInput, TileKind } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function speciesInput(overrides: Partial<SpeciesInput> = {}): SpeciesInput {
  return {
    name: "テスト",
    maxHp: 20,
    attack: 10,
    defense: 10,
    skinId: "skin-test",
    moveIds: ["bump", "bite"],
    ...overrides,
  };
}

/** A 3×2 map: a path along the top, a tree in the bottom-left corner. */
function mapInput(overrides: Partial<MapInput> = {}): MapInput {
  const tiles: TileKind[] = ["path", "path", "grass", "tree", "water", "path"];
  return {
    name: "テスト",
    width: 3,
    height: 2,
    tiles,
    spawn: { x: 0, y: 0 },
    encounters: [{ speciesId: "moss", weight: 5 }],
    exits: [{ at: { x: 1, y: 0 }, to: { mapId: "elsewhere", position: { x: 4, y: 4 } } }],
    ...overrides,
  };
}

/** An exit from a tile of the 3×2 fixture. Where it leads is not this package's to judge. */
function exitFrom(x: number, y: number) {
  return { at: { x, y }, to: { mapId: "elsewhere", position: { x: 0, y: 0 } } };
}

// ---------------------------------------------------------------------------

describe("what the checks hand back", () => {
  /** Stand in for whatever stores master data: each asks for a value that was checked. */
  const keepMove = (move: Checked<MoveInput>): MoveInput => move;
  const keepSpecies = (kind: Checked<SpeciesInput>): SpeciesInput => kind;
  const keepMap = (map: Checked<MapInput>): MapInput => map;

  it("is marked as checked, and is the value that was handed in", () => {
    const move = { name: "ぶつかる", power: 5 };
    const kind = speciesInput();
    const map = mapInput();

    const moveOk = checkMove(move);
    const kindOk = checkSpecies(kind);
    const mapOk = checkMap(map);
    expect(moveOk.ok && keepMove(moveOk.value)).toBe(move);
    expect(kindOk.ok && keepSpecies(kindOk.value)).toBe(kind);
    expect(mapOk.ok && keepMap(mapOk.value)).toBe(map);
  });

  it("is the only thing that is: the right shape alone is not enough", () => {
    // Nothing in this function runs. It is here for `tsc`, which fails on a
    // `@ts-expect-error` with nothing to suppress: if a value that skipped
    // its check could be passed where a checked one is asked for, the build
    // stops here.
    const attempts = (move: MoveInput, kind: SpeciesInput, map: MapInput): void => {
      // @ts-expect-error — a move that was not checked
      keepMove(move);
      // @ts-expect-error — a species that was not checked
      keepSpecies(kind);
      // @ts-expect-error — a map that was not checked
      keepMap(map);
    };
    expect(attempts).toBeTypeOf("function");
  });
});

describe("checkMove", () => {
  it("accepts a move within the limits, and hands it back", () => {
    const input = { name: "ぶつかる", power: 5 };
    expect(checkMove(input)).toEqual({ ok: true, value: input });
  });

  it("accepts the limits themselves", () => {
    expect(checkMove({ name: "あ".repeat(MOVE_LIMITS.maxNameLength), power: 1 }).ok).toBe(true);
    expect(checkMove({ name: "あ", power: MOVE_LIMITS.maxPower }).ok).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["too long", "あ".repeat(MOVE_LIMITS.maxNameLength + 1)],
  ])("refuses a name that is %s", (_label, name) => {
    expect(checkMove({ name, power: 5 })).toEqual({ ok: false, error: { kind: "bad_name" } });
  });

  it.each([
    ["zero", 0],
    ["negative", -3],
    ["over the limit", MOVE_LIMITS.maxPower + 1],
    ["a fraction", 2.5],
    ["not a number", Number.NaN],
  ])("refuses a power that is %s", (_label, power) => {
    expect(checkMove({ name: "ぶつかる", power })).toEqual({
      ok: false,
      error: { kind: "bad_power", power },
    });
  });

  it("draws the lower limit where a move still means something", () => {
    // What the rule is protecting: at power 0 the stats stop mattering, because
    // every hit is rounded up to 1.
    const weak = { attack: 1 };
    const strong = { attack: 999 };
    const target = { defense: 1 };
    expect(calcDamage(strong, target, { power: 0 }, 1)).toBe(
      calcDamage(weak, target, { power: 0 }, 1),
    );
    expect(calcDamage(strong, target, { power: 1 }, 1)).toBeGreaterThan(
      calcDamage(weak, target, { power: 1 }, 1),
    );
  });
});

describe("checkSpecies", () => {
  it("accepts a species within every limit, and hands it back", () => {
    const input = speciesInput();
    expect(checkSpecies(input)).toEqual({ ok: true, value: input });
  });

  it("accepts the limits themselves", () => {
    const { maxStat, maxMoves, maxNameLength } = SPECIES_LIMITS;
    const atLimits = speciesInput({
      name: "x".repeat(maxNameLength),
      maxHp: maxStat,
      attack: 1,
      defense: maxStat,
      moveIds: Array.from({ length: maxMoves }, (_, i) => `move-${i}`),
    });
    expect(checkSpecies(atLimits).ok).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["nothing but spaces", "   "],
    ["too long", "x".repeat(SPECIES_LIMITS.maxNameLength + 1)],
  ])("rejects a name that is %s", (_label, name) => {
    expect(checkSpecies(speciesInput({ name }))).toEqual({
      ok: false,
      error: { kind: "bad_name" },
    });
  });

  it.each([
    ["maxHp", 0],
    ["maxHp", -5],
    ["attack", 0],
    ["defense", 0],
    ["attack", SPECIES_LIMITS.maxStat + 1],
    ["defense", 1.5],
    ["maxHp", Number.NaN],
  ] as const)("rejects %s = %s", (stat, value) => {
    expect(checkSpecies(speciesInput({ [stat]: value }))).toEqual({
      ok: false,
      error: { kind: "bad_stat", stat, value },
    });
  });

  it("rejects a species with no moves, since it would have no turn to take", () => {
    expect(checkSpecies(speciesInput({ moveIds: [] }))).toEqual({
      ok: false,
      error: { kind: "bad_move_count", got: 0 },
    });
  });

  it("rejects more moves than a monster can know", () => {
    const moveIds = Array.from({ length: SPECIES_LIMITS.maxMoves + 1 }, (_, i) => `move-${i}`);
    expect(checkSpecies(speciesInput({ moveIds }))).toEqual({
      ok: false,
      error: { kind: "bad_move_count", got: moveIds.length },
    });
  });

  it("rejects the same move listed twice", () => {
    expect(checkSpecies(speciesInput({ moveIds: ["bump", "bite", "bump"] }))).toEqual({
      ok: false,
      error: { kind: "duplicate_move", moveId: "bump" },
    });
  });
});

describe("exitAt", () => {
  const exits = [
    { at: { x: 1, y: 0 }, to: { mapId: "pond", position: { x: 0, y: 1 } } },
    { at: { x: 2, y: 1 }, to: { mapId: "cave", position: { x: 3, y: 3 } } },
  ];

  it("finds the exit on a tile", () => {
    expect(exitAt({ exits }, { x: 2, y: 1 })).toEqual(exits[1]);
  });

  it("finds nothing on a tile without one, or on a map with no way out", () => {
    expect(exitAt({ exits }, { x: 1, y: 1 })).toBeUndefined();
    expect(exitAt({ exits: [] }, { x: 1, y: 0 })).toBeUndefined();
  });

  it("goes by where the exit is, not by where it leads", () => {
    // (0, 1) is where the first exit arrives, on another map.
    expect(exitAt({ exits }, { x: 0, y: 1 })).toBeUndefined();
  });
});

describe("checkMap", () => {
  it("accepts a map within every limit, and hands it back", () => {
    const input = mapInput();
    expect(checkMap(input)).toEqual({ ok: true, value: input });
  });

  it("accepts the largest map allowed", () => {
    const { maxWidth, maxHeight } = MAP_LIMITS;
    const tiles = new Array<TileKind>(maxWidth * maxHeight).fill("path");
    expect(checkMap(mapInput({ width: maxWidth, height: maxHeight, tiles })).ok).toBe(true);
  });

  it("accepts a map nothing lives on", () => {
    expect(checkMap(mapInput({ encounters: [] })).ok).toBe(true);
  });

  it("accepts a map with no way out, and one with an exit on every tile that can be stood on", () => {
    expect(checkMap(mapInput({ exits: [] })).ok).toBe(true);
    // The fixture's walkable tiles: the top row, and the bottom-right corner.
    const everywhere = [exitFrom(0, 0), exitFrom(1, 0), exitFrom(2, 0), exitFrom(2, 1)];
    expect(checkMap(mapInput({ exits: everywhere })).ok).toBe(true);
  });

  it("leaves where an exit leads to the caller: any map id and any position pass here", () => {
    const exits = [{ at: { x: 1, y: 0 }, to: { mapId: "", position: { x: -5, y: 99 } } }];
    expect(checkMap(mapInput({ exits })).ok).toBe(true);
  });

  it.each([
    ["on a tree", 0, 1],
    ["in the water", 1, 1],
    ["off the map", 3, 0],
    ["between tiles", 0.5, 0],
  ])("rejects an exit %s, where nobody could step onto it", (_label, x, y) => {
    expect(checkMap(mapInput({ exits: [exitFrom(x, y)] }))).toEqual({
      ok: false,
      error: { kind: "bad_exit", at: { x, y } },
    });
  });

  it("rejects two exits on one tile", () => {
    expect(checkMap(mapInput({ exits: [exitFrom(1, 0), exitFrom(2, 0), exitFrom(1, 0)] }))).toEqual(
      {
        ok: false,
        error: { kind: "duplicate_exit", at: { x: 1, y: 0 } },
      },
    );
  });

  it("rejects more exits than a map may have", () => {
    const { maxWidth, maxExits } = MAP_LIMITS;
    // One long row of path, so there is room for one exit too many.
    const tiles = new Array<TileKind>(maxWidth).fill("path");
    const exits = Array.from({ length: maxExits + 1 }, (_, x) => exitFrom(x, 0));
    expect(checkMap(mapInput({ width: maxWidth, height: 1, tiles, exits }))).toEqual({
      ok: false,
      error: { kind: "too_many_exits", got: maxExits + 1, max: maxExits },
    });
    expect(
      checkMap(mapInput({ width: maxWidth, height: 1, tiles, exits: exits.slice(1) })).ok,
    ).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["too long", "x".repeat(MAP_LIMITS.maxNameLength + 1)],
  ])("rejects a name that is %s", (_label, name) => {
    expect(checkMap(mapInput({ name }))).toEqual({ ok: false, error: { kind: "bad_name" } });
  });

  it.each([
    ["no width", 0, 2],
    ["a negative height", 3, -1],
    ["too wide", MAP_LIMITS.maxWidth + 1, 2],
    ["too tall", 3, MAP_LIMITS.maxHeight + 1],
    ["a width between tiles", 2.5, 2],
  ])("rejects a size with %s", (_label, width, height) => {
    expect(checkMap(mapInput({ width, height }))).toEqual({
      ok: false,
      error: { kind: "bad_size", width, height },
    });
  });

  it("rejects tiles that do not fill the grid exactly", () => {
    const short = mapInput().tiles.slice(0, 5);
    expect(checkMap(mapInput({ tiles: short }))).toEqual({
      ok: false,
      error: { kind: "bad_tile_count", got: 5, expected: 6 },
    });
  });

  it.each([
    ["on a tree", { x: 0, y: 1 }],
    ["in the water", { x: 1, y: 1 }],
    ["off the map", { x: 3, y: 0 }],
    ["at a negative position", { x: -1, y: 0 }],
  ])("rejects a spawn %s, where a new game would start stuck", (_label, spawn) => {
    expect(checkMap(mapInput({ spawn }))).toEqual({
      ok: false,
      error: { kind: "bad_spawn", spawn },
    });
  });

  it("accepts a spawn in the grass: it is somewhere a player can stand", () => {
    expect(checkMap(mapInput({ spawn: { x: 2, y: 0 } })).ok).toBe(true);
  });

  it.each([
    ["zero", 0],
    ["negative", -3],
    ["over the limit", MAP_LIMITS.maxWeight + 1],
    ["a fraction", 2.5],
  ])("rejects an encounter weight that is %s", (_label, weight) => {
    expect(checkMap(mapInput({ encounters: [{ speciesId: "moss", weight }] }))).toEqual({
      ok: false,
      error: { kind: "bad_weight", speciesId: "moss", weight },
    });
  });

  it("rejects the same species listed twice on one map", () => {
    const encounters = [
      { speciesId: "moss", weight: 5 },
      { speciesId: "drop", weight: 3 },
      { speciesId: "moss", weight: 1 },
    ];
    expect(checkMap(mapInput({ encounters }))).toEqual({
      ok: false,
      error: { kind: "duplicate_encounter", speciesId: "moss" },
    });
  });
});
