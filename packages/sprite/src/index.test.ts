import { describe, expect, it } from "vitest";

import {
  CELLS_PER_FRAME,
  PART_SLOTS,
  SKIN_SPEC,
  expandFrame,
  packFrame,
  parseSkin,
  toRenderable,
} from "./index.js";
import type { CellGrid, Frame, PartSlot, Rect, Skin, SkinError } from "./index.js";

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
            painted[(y + dy) * SKIN_SPEC.canvasSize + x + dx] += 1;
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
