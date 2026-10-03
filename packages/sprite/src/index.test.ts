import { describe, expect, it } from "vitest";

import {
  APPEARANCE_SPEC,
  CELLS_PER_FRAME,
  PART_SLOTS,
  SKIN_SPEC,
  coloursOf,
  composeAppearance,
  expandFrame,
  frameAt,
  packFrame,
  parseAppearance,
  parseSkin,
  skinsNamedBy,
  toRenderable,
} from "./index.js";
import type {
  Appearance,
  AppearanceError,
  CellGrid,
  Frame,
  PaletteEntry,
  PartSlot,
  Rect,
  RenderableSkin,
  Skin,
  SkinError,
} from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seeded PRNG. The property tests must fail reproducibly or they are noise. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A grid of palette indices. `sticky` biases each cell towards its left
 * neighbour, which produces flat runs like real pixel art; without it the grid
 * is noise, which is the worst case for the merger and worth testing too.
 */
function randomGrid(rand: () => number, colours: number, sticky: boolean): number[] {
  const grid = new Array<number>(CELLS_PER_FRAME).fill(0);
  for (let i = 0; i < CELLS_PER_FRAME; i++) {
    const previous = grid[i - 1] ?? 0;
    grid[i] = sticky && i > 0 && rand() < 0.65 ? previous : Math.floor(rand() * (colours + 1));
  }
  return grid;
}

/** Paints rects back onto a blank grid — the inverse of the merge step. */
function gridFromRects(rects: readonly Rect[]): number[] {
  const size = SKIN_SPEC.canvasSize;
  const grid = new Array<number>(CELLS_PER_FRAME).fill(0);
  for (const [x, y, w, h, paletteIndex] of rects) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        grid[(y + dy) * size + x + dx] = paletteIndex;
      }
    }
  }
  return grid;
}

function frameOf(grid: CellGrid, durationMs = 120): Frame {
  return packFrame(grid, durationMs);
}

/** A one-part-visible skin, so a single grid can be pushed through the real API. */
function skinFromGrid(grid: CellGrid, colours: number): Skin {
  const blank = frameOf(new Array<number>(CELLS_PER_FRAME).fill(0));
  return {
    formatVersion: 1,
    name: "fixture",
    palette: Array.from({ length: colours }, (_, i) => ({
      id: `c${i}`,
      hex: "#123456",
    })),
    parts: PART_SLOTS.map((slot) => ({
      slot,
      frames: [slot === "body" ? frameOf(grid) : blank],
    })),
  };
}

/** Runs a grid through the public path and returns the rects it produced. */
function rectsOf(grid: CellGrid, colours = SKIN_SPEC.maxPaletteEntries): Rect[] {
  const renderable = toRenderable(skinFromGrid(grid, colours));
  const body = renderable.parts.find((part) => part.slot === "body");
  const frame = body?.frames[0];
  if (frame === undefined) throw new Error("fixture lost its body part");
  return frame.rects;
}

// ---------------------------------------------------------------------------
// Fixtures for the validator
// ---------------------------------------------------------------------------

const VALID_PALETTE = [
  { id: "skin", hex: "#e8b98a" },
  { id: "hair", hex: "#5a3921" },
];

/** A structurally valid payload, as it would arrive from the editor. */
function validInput(): Record<string, unknown> {
  return {
    formatVersion: 1,
    name: "fixture",
    palette: VALID_PALETTE.map((entry) => ({ ...entry })),
    parts: PART_SLOTS.map((slot) => ({
      slot,
      frames: [{ durationMs: 120, cells: [[slot === "body" ? 1 : 0, CELLS_PER_FRAME]] }],
    })),
  };
}

/** Applies one mutation to an otherwise valid payload. */
function inputWith(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...validInput(), ...patch };
}

function partsWith(slot: PartSlot, frames: unknown): unknown[] {
  return PART_SLOTS.map((s) =>
    s === slot
      ? { slot: s, frames }
      : { slot: s, frames: [{ durationMs: 120, cells: [[0, CELLS_PER_FRAME]] }] },
  );
}

function rejection(input: unknown): SkinError {
  const result = parseSkin(input);
  if (result.ok)
    throw new Error(`expected parseSkin to reject, got ${JSON.stringify(result.value)}`);
  return result.error;
}

function accepted(input: unknown): Skin {
  const result = parseSkin(input);
  if (!result.ok)
    throw new Error(`expected parseSkin to accept, got ${JSON.stringify(result.error)}`);
  return result.value;
}

// ---------------------------------------------------------------------------
// The property the format lives or dies by
// ---------------------------------------------------------------------------

describe("toRenderable", () => {
  it("loses nothing: expanding the merged rects reproduces the grid exactly", () => {
    const rand = mulberry32(0x5eed);
    for (let n = 0; n < 300; n++) {
      const colours = 1 + Math.floor(rand() * 6);
      const grid = randomGrid(rand, colours, n % 2 === 0);
      expect(gridFromRects(rectsOf(grid))).toEqual(grid);
    }
  });

  it("emits rects that never overlap", () => {
    const rand = mulberry32(0xc0ffee);
    for (let n = 0; n < 200; n++) {
      const grid = randomGrid(rand, 1 + Math.floor(rand() * 4), true);
      const painted = new Array<number>(CELLS_PER_FRAME).fill(0);
      for (const [x, y, w, h] of rectsOf(grid)) {
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const i = (y + dy) * SKIN_SPEC.canvasSize + x + dx;
            painted[i] = (painted[i] ?? 0) + 1;
          }
        }
      }
      expect(painted.every((count) => count <= 1)).toBe(true);
    }
  });

  it("draws nothing for transparent cells", () => {
    expect(rectsOf(new Array<number>(CELLS_PER_FRAME).fill(0))).toEqual([]);

    const rand = mulberry32(42);
    for (let n = 0; n < 50; n++) {
      const grid = randomGrid(rand, 3, true);
      const covered = gridFromRects(rectsOf(grid));
      grid.forEach((paletteIndex, i) => {
        if (paletteIndex === 0) expect(covered[i]).toBe(0);
      });
    }
  });

  it("collapses a flat fill to a single rect covering the canvas", () => {
    const size = SKIN_SPEC.canvasSize;
    expect(rectsOf(new Array<number>(CELLS_PER_FRAME).fill(2))).toEqual([[0, 0, size, size, 2]]);
  });

  it("merges a solid row into one wide rect rather than 16 cells", () => {
    const grid = new Array<number>(CELLS_PER_FRAME).fill(0);
    for (let x = 0; x < SKIN_SPEC.canvasSize; x++) grid[x] = 1;
    expect(rectsOf(grid)).toEqual([[0, 0, SKIN_SPEC.canvasSize, 1, 1]]);
  });

  it("keeps every part and its frame timing", () => {
    const skin = skinFromGrid(new Array<number>(CELLS_PER_FRAME).fill(1), 2);
    const renderable = toRenderable(skin);
    expect(renderable.parts.map((part) => part.slot)).toEqual([...PART_SLOTS]);
    expect(renderable.formatVersion).toBe(1);
    expect(renderable.palette).toEqual(skin.palette);
    expect(renderable.parts.every((part) => part.frames.every((f) => f.durationMs === 120))).toBe(
      true,
    );
  });

  it("does not alias the skin it was given", () => {
    const skin = skinFromGrid(new Array<number>(CELLS_PER_FRAME).fill(1), 2);
    const renderable = toRenderable(skin);
    const first = renderable.palette[0];
    if (first === undefined) throw new Error("empty palette");
    first.hex = "#000000";
    expect(skin.palette[0]?.hex).toBe("#123456");
  });
});

// ---------------------------------------------------------------------------
// Run-length encoding, both directions
// ---------------------------------------------------------------------------

describe("expandFrame / packFrame", () => {
  it("round-trips any grid", () => {
    const rand = mulberry32(7);
    for (let n = 0; n < 200; n++) {
      const grid = randomGrid(rand, 1 + Math.floor(rand() * 8), n % 3 !== 0);
      expect(expandFrame(packFrame(grid, 100))).toEqual(grid);
    }
  });

  it("always produces runs that cover exactly one canvas", () => {
    const rand = mulberry32(11);
    for (let n = 0; n < 100; n++) {
      const frame = packFrame(randomGrid(rand, 4, true), 100);
      const total = frame.cells.reduce((sum, [, runLength]) => sum + runLength, 0);
      expect(total).toBe(CELLS_PER_FRAME);
    }
  });

  it("merges runs of the same colour that arrived split", () => {
    const split: Frame = {
      durationMs: 100,
      cells: [
        [1, 100],
        [1, 156],
      ],
    };
    expect(packFrame(expandFrame(split), 100).cells).toEqual([[1, CELLS_PER_FRAME]]);
  });

  it("keeps a grid's row order (row-major, not column-major)", () => {
    const grid = new Array<number>(CELLS_PER_FRAME).fill(0);
    grid[SKIN_SPEC.canvasSize] = 3; // first cell of the second row
    const rects = rectsOf(grid);
    expect(rects).toEqual([[0, 1, 1, 1, 3]]);
  });
});

// ---------------------------------------------------------------------------
// The trust boundary
// ---------------------------------------------------------------------------

describe("parseSkin", () => {
  it("accepts a well-formed skin and hands back a usable Skin", () => {
    const skin = accepted(validInput());
    expect(skin.formatVersion).toBe(1);
    expect(skin.name).toBe("fixture");
    expect(skin.palette).toEqual(VALID_PALETTE);
    expect(skin.parts.map((part) => part.slot)).toEqual([...PART_SLOTS]);
    expect(() => toRenderable(skin)).not.toThrow();
  });

  it("puts parts back in draw order however they arrived", () => {
    const reversed = inputWith({ parts: [...(validInput().parts as unknown[])].reverse() });
    expect(accepted(reversed).parts.map((part) => part.slot)).toEqual([...PART_SLOTS]);
  });

  it("rebuilds the skin, so unknown properties cannot ride along into storage", () => {
    const hostile = inputWith({
      evil: "<script>alert(1)</script>",
      palette: [{ id: "skin", hex: "#e8b98a", onload: "alert(1)" }],
    });
    const serialized = JSON.stringify(accepted(hostile));
    expect(serialized).not.toContain("evil");
    expect(serialized).not.toContain("onload");
    expect(serialized).not.toContain("script");
  });

  describe("rejects payloads that are not a skin at all", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["an array", []],
      ["a string", "skin"],
      ["a number", 1],
    ])("%s", (_label, input) => {
      expect(rejection(input)).toEqual({ kind: "malformed", at: "$" });
    });

    it("a circular object", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(rejection(circular)).toEqual({ kind: "malformed", at: "$" });
    });

    it("a payload over the byte cap, before it looks at the shape", () => {
      const error = rejection({ junk: "x".repeat(SKIN_SPEC.maxBytes + 1) });
      expect(error.kind).toBe("too_large");
    });

    it("an unknown format version", () => {
      expect(rejection(inputWith({ formatVersion: 2 }))).toEqual({
        kind: "malformed",
        at: "$.formatVersion",
      });
    });
  });

  describe("rejects bad names", () => {
    it.each([
      ["missing", undefined],
      ["empty", ""],
      ["not a string", 7],
    ])("%s", (_label, name) => {
      expect(rejection(inputWith({ name }))).toEqual({ kind: "malformed", at: "$.name" });
    });

    it("over the length cap", () => {
      const name = "x".repeat(SKIN_SPEC.maxNameLength + 1);
      expect(rejection(inputWith({ name }))).toEqual({
        kind: "too_many",
        what: "name",
        got: name.length,
        max: SKIN_SPEC.maxNameLength,
      });
    });
  });

  describe("rejects palettes that could escape into CSS or SVG", () => {
    it.each([
      ["a colour keyword", "red"],
      ["shorthand hex", "#fff"],
      ["a url() reference", "url(#evil)"],
      ["a non-hex digit", "#12345g"],
      ["trailing junk", "#123456;x"],
      ["a javascript: url", "javascript:alert(1)"],
    ])("hex: %s", (_label, hex) => {
      expect(rejection(inputWith({ palette: [{ id: "skin", hex }] }))).toEqual({
        kind: "bad_hex",
        hex,
      });
    });

    it.each([
      ["uppercase", "Hair"],
      ["a space", "hair colour"],
      ["a CSS declaration", "hair;color:red"],
      ["a closing paren", "hair)"],
      ["an underscore", "hair_2"],
      ["empty", ""],
      ["over 32 characters", "h".repeat(33)],
    ])("id: %s", (_label, id) => {
      expect(rejection(inputWith({ palette: [{ id, hex: "#123456" }] }))).toEqual({
        kind: "bad_palette_id",
        id,
      });
    });

    it("a duplicate id, which would make a recolour ambiguous", () => {
      const palette = [
        { id: "hair", hex: "#111111" },
        { id: "hair", hex: "#222222" },
      ];
      expect(rejection(inputWith({ palette }))).toEqual({
        kind: "duplicate_palette_id",
        id: "hair",
      });
    });

    it("an empty palette", () => {
      expect(rejection(inputWith({ palette: [] }))).toEqual({ kind: "malformed", at: "$.palette" });
    });

    it("more colours than the spec allows", () => {
      const palette = Array.from({ length: SKIN_SPEC.maxPaletteEntries + 1 }, (_, i) => ({
        id: `c${i}`,
        hex: "#123456",
      }));
      expect(rejection(inputWith({ palette }))).toEqual({
        kind: "too_many",
        what: "palette",
        got: palette.length,
        max: SKIN_SPEC.maxPaletteEntries,
      });
    });
  });

  describe("rejects part sets that would not compose", () => {
    it("a missing slot", () => {
      const parts = (validInput().parts as unknown[]).slice(0, 4);
      expect(rejection(inputWith({ parts }))).toEqual({ kind: "missing_slot", slot: "hair" });
    });

    it("an unknown slot", () => {
      const parts = (validInput().parts as Record<string, unknown>[]).map((part, i) =>
        i === 0 ? { ...part, slot: "hat" } : part,
      );
      expect(rejection(inputWith({ parts }))).toEqual({ kind: "malformed", at: "$.parts[0].slot" });
    });

    it("a duplicated slot", () => {
      const parts = validInput().parts as Record<string, unknown>[];
      const first = parts[0];
      expect(rejection(inputWith({ parts: [first, first, ...parts.slice(1, 4)] }))).toEqual({
        kind: "malformed",
        at: "$.parts[1].slot",
      });
    });

    it("more parts than there are slots", () => {
      const parts = validInput().parts as unknown[];
      expect(rejection(inputWith({ parts: [...parts, parts[0]] }))).toEqual({
        kind: "too_many",
        what: "parts",
        got: PART_SLOTS.length + 1,
        max: PART_SLOTS.length,
      });
    });
  });

  describe("rejects bad frames", () => {
    it("no frames at all", () => {
      expect(rejection(inputWith({ parts: partsWith("hair", []) }))).toEqual({
        kind: "malformed",
        at: "$.parts[4].frames",
      });
    });

    it("more frames than the spec allows", () => {
      const frame = { durationMs: 120, cells: [[0, CELLS_PER_FRAME]] };
      const frames = Array.from({ length: SKIN_SPEC.maxFramesPerPart + 1 }, () => frame);
      expect(rejection(inputWith({ parts: partsWith("body", frames) }))).toEqual({
        kind: "too_many",
        what: "$.parts[0].frames",
        got: frames.length,
        max: SKIN_SPEC.maxFramesPerPart,
      });
    });

    it.each([
      ["zero", 0],
      ["negative", -1],
      ["fractional", 16.7],
      ["a string", "120"],
      ["over the cap", SKIN_SPEC.maxFrameDurationMs + 1],
    ])("a duration that is %s", (_label, durationMs) => {
      const frames = [{ durationMs, cells: [[0, CELLS_PER_FRAME]] }];
      expect(rejection(inputWith({ parts: partsWith("body", frames) }))).toEqual({
        kind: "malformed",
        at: "$.parts[0].frames[0].durationMs",
      });
    });
  });

  describe("rejects cells that do not describe one canvas", () => {
    it.each([
      ["one short", CELLS_PER_FRAME - 1],
      ["one over", CELLS_PER_FRAME + 1],
      ["wildly over", CELLS_PER_FRAME * 4],
    ])("a run total %s", (_label, total) => {
      const frames = [{ durationMs: 120, cells: [[1, total]] }];
      expect(rejection(inputWith({ parts: partsWith("body", frames) }))).toEqual({
        kind: "bad_cell_count",
        slot: "body",
        frame: 0,
        got: total,
      });
    });

    it("a palette index past the end of the palette", () => {
      const frames = [{ durationMs: 120, cells: [[VALID_PALETTE.length + 1, CELLS_PER_FRAME]] }];
      expect(rejection(inputWith({ parts: partsWith("body", frames) }))).toEqual({
        kind: "bad_palette_index",
        slot: "body",
        frame: 0,
        index: VALID_PALETTE.length + 1,
      });
    });

    it("accepts the last palette index, since 0 means transparent", () => {
      const frames = [{ durationMs: 120, cells: [[VALID_PALETTE.length, CELLS_PER_FRAME]] }];
      expect(parseSkin(inputWith({ parts: partsWith("body", frames) })).ok).toBe(true);
    });

    it.each([
      ["a bare number", [1, 2, 3]],
      ["a triple", [[1, 2, 3]]],
      ["a negative index", [[-1, CELLS_PER_FRAME]]],
      ["a zero-length run", [[1, 0]]],
      ["a fractional run", [[1, 12.5]]],
      ["a string run", [[1, "256"]]],
    ])("%s", (_label, cells) => {
      expect(
        rejection(inputWith({ parts: partsWith("body", [{ durationMs: 120, cells }]) })).kind,
      ).toBe("malformed");
    });
  });

  it("accepts a payload right at every limit", () => {
    const palette = Array.from({ length: SKIN_SPEC.maxPaletteEntries }, (_, i) => ({
      id: `c${i}`,
      hex: "#abcdef",
    }));
    const frame = {
      durationMs: SKIN_SPEC.maxFrameDurationMs,
      cells: [[SKIN_SPEC.maxPaletteEntries, CELLS_PER_FRAME]],
    };
    const input = {
      formatVersion: 1,
      name: "x".repeat(SKIN_SPEC.maxNameLength),
      palette,
      parts: PART_SLOTS.map((slot) => ({
        slot,
        frames: Array.from({ length: SKIN_SPEC.maxFramesPerPart }, () => frame),
      })),
    };
    const skin = accepted(input);
    expect(skin.parts).toHaveLength(PART_SLOTS.length);
    expect(skin.parts[0]?.frames).toHaveLength(SKIN_SPEC.maxFramesPerPart);
  });
});

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

describe("frameAt", () => {
  const timeline = [{ durationMs: 100 }, { durationMs: 50 }, { durationMs: 200 }];

  it.each([
    [0, 0],
    [99, 0],
    [100, 1],
    [149, 1],
    [150, 2],
    [349, 2],
  ])("shows each frame for as long as it lasts (%i ms)", (elapsedMs, frame) => {
    expect(frameAt(timeline, elapsedMs)).toBe(frame);
  });

  it("loops back to the first frame when the timeline runs out", () => {
    expect(frameAt(timeline, 350)).toBe(0);
    expect(frameAt(timeline, 350 + 120)).toBe(1);
    expect(frameAt(timeline, 350 * 1000 + 160)).toBe(2);
  });

  it("stays on the only frame of a still image", () => {
    for (const elapsedMs of [0, 1, 119, 120, 5_000]) {
      expect(frameAt([{ durationMs: 120 }], elapsedMs)).toBe(0);
    }
  });

  it("gives every frame time on screen in proportion to its duration", () => {
    const shown = [0, 0, 0];
    for (let elapsedMs = 0; elapsedMs < 3500; elapsedMs++) {
      const frame = frameAt(timeline, elapsedMs);
      shown[frame] = (shown[frame] ?? 0) + 1;
    }
    expect(shown).toEqual([1000, 500, 2000]);
  });

  it("wraps a time from before the start the same way", () => {
    // 10 ms before the start is 10 ms before the end of the loop.
    expect(frameAt(timeline, -10)).toBe(2);
    expect(frameAt(timeline, -350)).toBe(0);
  });

  it.each([
    ["no frames", [], 500],
    ["durations that add up to nothing", [{ durationMs: 0 }, { durationMs: 0 }], 500],
    ["a time that is not a number", timeline, Number.NaN],
    ["a time that never arrives", timeline, Number.POSITIVE_INFINITY],
  ])("answers 0 for %s", (_label, frames, elapsedMs) => {
    expect(frameAt(frames, elapsedMs)).toBe(0);
  });

  it("skips a frame that lasts no time at all", () => {
    const withGap = [{ durationMs: 100 }, { durationMs: 0 }, { durationMs: 100 }];
    expect(frameAt(withGap, 99)).toBe(0);
    expect(frameAt(withGap, 100)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Appearances — the recipe, and what it puts together
// ---------------------------------------------------------------------------

/** A recipe as a screen would send it. */
function validAppearance(): Record<string, unknown> {
  return {
    skinId: "skin-a",
    parts: { hair: "skin-b" },
    colours: [{ id: "hair", hex: "#cc3344" }],
  };
}

function appearanceWith(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...validAppearance(), ...patch };
}

function appearanceRejection(input: unknown): AppearanceError {
  const result = parseAppearance(input);
  if (result.ok) {
    throw new Error(`expected parseAppearance to reject, got ${JSON.stringify(result.value)}`);
  }
  return result.error;
}

function acceptedAppearance(input: unknown): Appearance {
  const result = parseAppearance(input);
  if (!result.ok) {
    throw new Error(`expected parseAppearance to accept, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

describe("parseAppearance", () => {
  it("accepts a recipe and hands it back", () => {
    expect(acceptedAppearance(validAppearance())).toEqual({
      skinId: "skin-a",
      parts: { hair: "skin-b" },
      colours: [{ id: "hair", hex: "#cc3344" }],
    });
  });

  it("accepts the plainest recipe there is: a skin, worn as drawn", () => {
    expect(acceptedAppearance({ skinId: "skin-a", parts: {}, colours: [] })).toEqual({
      skinId: "skin-a",
      parts: {},
      colours: [],
    });
  });

  it("rebuilds the recipe, so unknown properties cannot ride along into storage", () => {
    const hostile = {
      ...validAppearance(),
      userId: "someone-else",
      colours: [{ id: "hair", hex: "#cc3344", onload: "alert(1)" }],
    };
    const serialized = JSON.stringify(acceptedAppearance(hostile));
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("onload");
  });

  it("writes the slots down in draw order however they arrived", () => {
    const parts = { hair: "skin-b", body: "skin-c", shoes: "skin-d" };
    expect(Object.keys(acceptedAppearance(appearanceWith({ parts })).parts)).toEqual([
      "body",
      "shoes",
      "hair",
    ]);
  });

  it("does not keep a slot that is taken from the skin that is worn anyway", () => {
    const parts = { hair: "skin-a", shirt: "skin-b" };
    expect(acceptedAppearance(appearanceWith({ parts })).parts).toEqual({ shirt: "skin-b" });
  });

  describe("rejects what is not a recipe at all", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["an array", []],
      ["a string", "skin-a"],
      ["a number", 1],
    ])("%s", (_label, input) => {
      expect(appearanceRejection(input)).toEqual({ kind: "malformed", at: "$" });
    });
  });

  describe("rejects a skin id that could not be one", () => {
    it.each([
      ["missing", undefined],
      ["a number", 7],
      ["empty", ""],
      ["over the length an id can have", "s".repeat(APPEARANCE_SPEC.maxSkinIdLength + 1)],
      ["an object", { id: "skin-a" }],
    ])("worn skin: %s", (_label, skinId) => {
      expect(appearanceRejection(appearanceWith({ skinId }))).toEqual({
        kind: "malformed",
        at: "$.skinId",
      });
    });

    it.each([
      ["a number", 7],
      ["empty", ""],
      ["over the length an id can have", "s".repeat(APPEARANCE_SPEC.maxSkinIdLength + 1)],
      ["null", null],
    ])("a part's skin: %s", (_label, from) => {
      expect(appearanceRejection(appearanceWith({ parts: { shirt: from } }))).toEqual({
        kind: "malformed",
        at: "$.parts.shirt",
      });
    });
  });

  describe("rejects parts that are not slots", () => {
    it.each([
      ["missing", undefined],
      ["an array", [["hair", "skin-b"]]],
      ["a string", "hair"],
      ["a slot the format does not have", { hat: "skin-b" }],
      ["a property every object has", JSON.parse('{"__proto__":"skin-b"}') as unknown],
    ])("%s", (_label, parts) => {
      expect(appearanceRejection(appearanceWith({ parts }))).toEqual({
        kind: "malformed",
        at: "$.parts",
      });
    });
  });

  describe("rejects colours that could escape into CSS", () => {
    it.each([
      ["a colour keyword", "red"],
      ["shorthand hex", "#fff"],
      ["a url() reference", "url(https://example.invalid/x.svg#a)"],
      ["a non-hex digit", "#12345g"],
      ["trailing junk", "#123456;x"],
      ["a second declaration", "#123456;background:url(x)"],
      ["a var() of its own", "var(--c-other)"],
    ])("hex: %s", (_label, hex) => {
      expect(appearanceRejection(appearanceWith({ colours: [{ id: "hair", hex }] }))).toEqual({
        kind: "bad_hex",
        hex,
      });
    });

    it.each([
      ["uppercase", "Hair"],
      ["a space", "hair colour"],
      ["a CSS declaration", "hair:red;--c-skin"],
      ["a closing brace", "hair}"],
      ["an underscore", "hair_2"],
      ["empty", ""],
      ["over 32 characters", "h".repeat(33)],
    ])("id: %s", (_label, id) => {
      expect(appearanceRejection(appearanceWith({ colours: [{ id, hex: "#123456" }] }))).toEqual({
        kind: "bad_palette_id",
        id,
      });
    });

    it("the same id twice, which would leave it to chance which colour wins", () => {
      const colours = [
        { id: "hair", hex: "#111111" },
        { id: "hair", hex: "#222222" },
      ];
      expect(appearanceRejection(appearanceWith({ colours }))).toEqual({
        kind: "duplicate_palette_id",
        id: "hair",
      });
    });

    it.each([
      ["missing", undefined, "$.colours"],
      ["an object keyed by id", { hair: "#cc3344" }, "$.colours"],
      ["an entry that is not an object", ["hair"], "$.colours[0]"],
      ["an entry with no id", [{ hex: "#cc3344" }], "$.colours[0].id"],
      ["an entry with no hex", [{ id: "hair" }], "$.colours[0].hex"],
      ["a hex that is a number", [{ id: "hair", hex: 0xcc3344 }], "$.colours[0].hex"],
    ])("the wrong shape: %s", (_label, colours, at) => {
      expect(appearanceRejection(appearanceWith({ colours }))).toEqual({ kind: "malformed", at });
    });

    it("more colours than a skin can have", () => {
      const colours = Array.from({ length: APPEARANCE_SPEC.maxColours + 1 }, (_, i) => ({
        id: `c${i}`,
        hex: "#123456",
      }));
      expect(appearanceRejection(appearanceWith({ colours }))).toEqual({
        kind: "too_many",
        what: "colours",
        got: colours.length,
        max: APPEARANCE_SPEC.maxColours,
      });
    });
  });

  it("accepts an id that is also the name of something every object has", () => {
    // "constructor" matches the id pattern. The recipe keeps colours as a list
    // so that a name like this is only ever data.
    const colours = [{ id: "constructor", hex: "#123456" }];
    expect(acceptedAppearance(appearanceWith({ colours })).colours).toEqual(colours);
  });
});

/** A skin with something different drawn on every part, through the real pipeline. */
function drawnSkin(seed: number, palette: PaletteEntry[], frames = 1): RenderableSkin {
  const rand = mulberry32(seed);
  const parsed = parseSkin({
    formatVersion: 1,
    name: `fixture ${seed}`,
    palette,
    parts: PART_SLOTS.map((slot) => ({
      slot,
      frames: Array.from({ length: frames }, (_, f) =>
        frameOf(randomGrid(rand, palette.length, true), 100 + 10 * f),
      ),
    })),
  });
  if (!parsed.ok) throw new Error(`fixture is invalid: ${JSON.stringify(parsed.error)}`);
  return toRenderable(parsed.value);
}

/**
 * What one frame of one part shows, cell by cell, as the palette entry each
 * cell is painted with. This is what has to survive being composed: not the
 * colour numbers, which are renumbered, but what they stand for.
 */
function shown(skin: RenderableSkin, slot: PartSlot, frame = 0): (string | null)[] {
  const rects = skin.parts.find((part) => part.slot === slot)?.frames[frame]?.rects;
  if (rects === undefined) throw new Error(`no frame ${frame} for ${slot}`);
  return gridFromRects(rects).map((index) => {
    if (index === 0) return null;
    const entry = skin.palette[index - 1];
    if (entry === undefined) throw new Error(`colour ${index} is not in the palette`);
    return `${entry.id} ${entry.hex}`;
  });
}

const PALETTE_A: PaletteEntry[] = [
  { id: "skin", hex: "#e8b98a" },
  { id: "hair", hex: "#5a3921" },
  { id: "shirt", hex: "#3f7bd6" },
];

// Shares two ids with A, in other colours, and has one of its own.
const PALETTE_B: PaletteEntry[] = [
  { id: "hair", hex: "#222222" },
  { id: "hat", hex: "#aa2200" },
  { id: "skin", hex: "#c68642" },
  { id: "shirt", hex: "#ffffff" },
];

describe("skinsNamedBy", () => {
  it("names the worn skin alone when nothing is swapped", () => {
    expect(skinsNamedBy({ skinId: "a", parts: {} })).toEqual(["a"]);
  });

  it("names each skin once, however many slots are taken from it, worn skin first", () => {
    const parts = { hair: "b", shoes: "b", shirt: "c" };
    expect(skinsNamedBy({ skinId: "a", parts })).toEqual(["a", "c", "b"]);
  });
});

describe("composeAppearance", () => {
  const a = drawnSkin(1, PALETTE_A, 2);
  const b = drawnSkin(2, PALETTE_B, 3);
  const skins = new Map([
    ["a", a],
    ["b", b],
  ]);

  it("draws the worn skin exactly as it is when nothing is swapped", () => {
    const look = composeAppearance({ skinId: "a", parts: {} }, skins);
    expect(look).toEqual(a);
  });

  it("takes each swapped slot from the other skin and leaves the rest alone", () => {
    // Every way of choosing, for each of the five slots, between two skins.
    for (let mask = 0; mask < 1 << PART_SLOTS.length; mask++) {
      const parts: Partial<Record<PartSlot, string>> = {};
      PART_SLOTS.forEach((slot, i) => {
        if ((mask & (1 << i)) !== 0) parts[slot] = "b";
      });

      const look = composeAppearance({ skinId: "a", parts }, skins);
      if (look === undefined) throw new Error("the worn skin was there");

      for (const slot of PART_SLOTS) {
        const source = parts[slot] === undefined ? a : b;
        const frames = source.parts.find((part) => part.slot === slot)?.frames ?? [];
        const composed = look.parts.find((part) => part.slot === slot)?.frames ?? [];
        // Each part brings its own frames and timings with it.
        expect(composed.map((frame) => frame.durationMs)).toEqual(
          frames.map((frame) => frame.durationMs),
        );
        frames.forEach((_, f) => {
          expect(shown(look, slot, f)).toEqual(shown(source, slot, f));
        });
      }
    }
  });

  it("keeps the parts in draw order whatever the recipe says first", () => {
    const look = composeAppearance({ skinId: "a", parts: { hair: "b", body: "b" } }, skins);
    expect(look?.parts.map((part) => part.slot)).toEqual([...PART_SLOTS]);
  });

  it("carries a skin's palette once, however many of its parts are used", () => {
    const look = composeAppearance({ skinId: "a", parts: { hair: "b", shoes: "b" } }, skins);
    expect(look?.palette).toEqual([...PALETTE_A, ...PALETTE_B]);
  });

  it("leaves out the palette of a skin that contributes nothing", () => {
    const everything = Object.fromEntries(PART_SLOTS.map((slot) => [slot, "b"]));
    const look = composeAppearance({ skinId: "a", parts: everything }, skins);
    expect(look?.palette).toEqual(PALETTE_B);
  });

  it("falls back to the worn skin's own part when the other skin is not there", () => {
    const look = composeAppearance({ skinId: "a", parts: { hair: "gone" } }, skins);
    expect(look).toEqual(a);
  });

  it("has nothing to draw when the worn skin is not there", () => {
    expect(composeAppearance({ skinId: "gone", parts: { hair: "b" } }, skins)).toBeUndefined();
  });

  it("does not change the skins it was given", () => {
    const before = JSON.stringify([a, b]);
    composeAppearance({ skinId: "a", parts: { hair: "b", pants: "b" } }, skins);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});

describe("coloursOf", () => {
  /** A skin whose body is painted with exactly these colour numbers. */
  function paintedWith(palette: PaletteEntry[], indices: number[]): RenderableSkin {
    const grid = new Array<number>(CELLS_PER_FRAME).fill(0);
    indices.forEach((index, i) => {
      grid[i * 2] = index;
    });
    const parsed = parseSkin({
      formatVersion: 1,
      name: "fixture",
      palette,
      parts: PART_SLOTS.map((slot) => ({
        slot,
        frames: [frameOf(slot === "body" ? grid : new Array<number>(CELLS_PER_FRAME).fill(0))],
      })),
    });
    if (!parsed.ok) throw new Error(`fixture is invalid: ${JSON.stringify(parsed.error)}`);
    return toRenderable(parsed.value);
  }

  it("lists the colours that are painted with, in palette order", () => {
    expect(coloursOf(paintedWith(PALETTE_A, [3, 1]))).toEqual([PALETTE_A[0], PALETTE_A[2]]);
  });

  it("leaves out a colour no cell uses", () => {
    expect(coloursOf(paintedWith(PALETTE_A, [2])).map((entry) => entry.id)).toEqual(["hair"]);
  });

  it("is empty for a skin with nothing drawn on it", () => {
    expect(coloursOf(paintedWith(PALETTE_A, []))).toEqual([]);
  });

  it("counts a colour used only in a later frame", () => {
    const only = (index: number) => new Array<number>(CELLS_PER_FRAME).fill(index);
    const parsed = parseSkin({
      formatVersion: 1,
      name: "fixture",
      palette: PALETTE_A,
      parts: PART_SLOTS.map((slot) => ({
        slot,
        frames: slot === "body" ? [frameOf(only(1)), frameOf(only(3))] : [frameOf(only(0))],
      })),
    });
    if (!parsed.ok) throw new Error(`fixture is invalid: ${JSON.stringify(parsed.error)}`);
    expect(coloursOf(toRenderable(parsed.value)).map((entry) => entry.id)).toEqual([
      "skin",
      "shirt",
    ]);
  });

  it("does not offer the colours of a skin whose swapped-in part has nothing drawn on it", () => {
    // Both fixtures draw on the body only. B is worn, and A lends its shirt,
    // which is blank: A's palette comes along, but nothing is painted with it.
    const a = paintedWith(PALETTE_A, [1, 2, 3]);
    const b = paintedWith(PALETTE_B, [1, 2, 3, 4]);
    const look = composeAppearance(
      { skinId: "b", parts: { shirt: "a" } },
      new Map([
        ["a", a],
        ["b", b],
      ]),
    );
    if (look === undefined) throw new Error("the worn skin was there");
    expect(look.palette).toEqual([...PALETTE_B, ...PALETTE_A]);
    expect(coloursOf(look)).toEqual(PALETTE_B);
  });

  it("offers every role once across the skins that are actually drawn", () => {
    const a = drawnSkin(3, PALETTE_A);
    const b = drawnSkin(4, PALETTE_B);
    const look = composeAppearance(
      { skinId: "a", parts: { hair: "b" } },
      new Map([
        ["a", a],
        ["b", b],
      ]),
    );
    if (look === undefined) throw new Error("the worn skin was there");
    const ids = coloursOf(look).map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    // A comes first, so where both have an id it is A's colour that is shown.
    expect(coloursOf(look).find((entry) => entry.id === "hair")?.hex).toBe("#5a3921");
    expect(ids).toContain("hat");
  });
});
