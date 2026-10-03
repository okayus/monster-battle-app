import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CELLS_PER_FRAME,
  PART_SLOTS,
  SKIN_SPEC,
  packFrame,
  parseSkin,
  toRenderable,
} from "@mba/sprite";
import type { PartSlot, RenderableSkin, Skin } from "@mba/sprite";

import { Sprite } from "./index.js";

// ---------------------------------------------------------------------------
// A hand-drawn sample skin
//
// Written as ASCII so the art is reviewable in the diff. Each row is one
// canvas row; each character is a palette index via LEGEND, and `.` is
// transparent. This is the shape the editor will produce numerically.
// ---------------------------------------------------------------------------

const LEGEND: Record<string, number> = { ".": 0, s: 1, h: 2, t: 3, p: 4, o: 5 };

const PALETTE = [
  { id: "skin", hex: "#e8b98a" },
  { id: "hair", hex: "#5a3921" },
  { id: "shirt", hex: "#3f7bd6" },
  { id: "pants", hex: "#2f3a56" },
  { id: "shoes", hex: "#7a4a2a" },
];

const ART: Record<PartSlot, string[]> = {
  body: [
    "................",
    "................",
    ".....ssssss.....",
    ".....ssssss.....",
    ".....ssssss.....",
    "......ssss......",
    "....s......s....",
    "....s......s....",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  shirt: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    ".....tttttt.....",
    ".....tttttt.....",
    ".....tttttt.....",
    ".....tttttt.....",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  pants: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    ".....pppppp.....",
    ".....pp..pp.....",
    ".....pp..pp.....",
    ".....pp..pp.....",
    "................",
    "................",
  ],
  shoes: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "....ooo..ooo....",
    "................",
  ],
  hair: [
    "................",
    "......hhhh......",
    ".....hhhhhh.....",
    ".....h....h.....",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
};

function gridFromArt(rows: string[]): number[] {
  const grid = new Array<number>(CELLS_PER_FRAME).fill(0);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      grid[y * SKIN_SPEC.canvasSize + x] = LEGEND[row[x] ?? "."] ?? 0;
    }
  });
  return grid;
}

/** The sample as it would arrive from the editor — plain JSON, no types. */
function sampleInput(): unknown {
  return {
    formatVersion: 1,
    name: "sample",
    palette: PALETTE.map((entry) => ({ ...entry })),
    parts: PART_SLOTS.map((slot) => ({
      slot,
      frames: [packFrame(gridFromArt(ART[slot]), 120)],
    })),
  };
}

function sampleSkin(): Skin {
  const result = parseSkin(sampleInput());
  if (!result.ok) throw new Error(`sample skin is invalid: ${JSON.stringify(result.error)}`);
  return result.value;
}

function markupOf(skin: RenderableSkin, frame?: number): string {
  return renderToStaticMarkup(<Sprite skin={skin} frame={frame} />);
}

/**
 * Two parts that animate on different clocks. The body flips every 100 ms
 * between a rect at x=0 and one at x=1; the hair holds each of its two frames
 * for 300 ms, at x=10 and x=11.
 */
const TWO_CLOCKS: RenderableSkin = {
  formatVersion: 1,
  palette: [{ id: "skin", hex: "#e8b98a" }],
  parts: [
    {
      slot: "body",
      frames: [
        { durationMs: 100, rects: [[0, 0, 1, 1, 1]] },
        { durationMs: 100, rects: [[1, 0, 1, 1, 1]] },
      ],
    },
    {
      slot: "hair",
      frames: [
        { durationMs: 300, rects: [[10, 0, 1, 1, 1]] },
        { durationMs: 300, rects: [[11, 0, 1, 1, 1]] },
      ],
    },
  ],
};

/** The x of each rect drawn, in part order. */
function xsAt(elapsedMs: number): string[] {
  const markup = renderToStaticMarkup(<Sprite skin={TWO_CLOCKS} elapsedMs={elapsedMs} />);
  return [...markup.matchAll(/<rect x="(\d+)"/g)].map((m) => m[1] ?? "");
}

// ---------------------------------------------------------------------------

describe("Sprite", () => {
  it("draws the hand-drawn sample skin", () => {
    const markup = markupOf(toRenderable(sampleSkin()));

    expect(markup).toContain("<svg");
    expect(markup).toContain('viewBox="0 0 16 16"');
    expect(markup).toContain('shape-rendering="crispEdges"');
    expect(markup.match(/<rect /g)?.length ?? 0).toBeGreaterThan(0);
  });

  it("keeps the parts in back-to-front draw order", () => {
    const markup = markupOf(toRenderable(sampleSkin()));
    const drawn = [...markup.matchAll(/data-part="([a-z]+)"/g)].map((m) => m[1]);
    expect(drawn).toEqual([...PART_SLOTS]);
  });

  it("addresses colours through CSS variables, so a recolour needs no new skin", () => {
    const markup = markupOf(toRenderable(sampleSkin()));
    for (const entry of PALETTE) {
      expect(markup).toContain(`fill="var(--c-${entry.id}, ${entry.hex})"`);
    }
  });

  it("wears other colours by setting those variables, without touching what is drawn", () => {
    const skin = toRenderable(sampleSkin());
    const worn = renderToStaticMarkup(
      <Sprite
        skin={skin}
        colours={[
          { id: "hair", hex: "#cc3344" },
          { id: "shoes", hex: "#101010" },
        ]}
      />,
    );

    expect(worn).toContain('style="--c-hair:#cc3344;--c-shoes:#101010"');
    // Every cell still asks for its variable and still carries the colour it
    // was drawn in: with the two variables taken away, this is the same sprite.
    expect(worn.replace(' style="--c-hair:#cc3344;--c-shoes:#101010"', "")).toBe(markupOf(skin));
  });

  it("sets no variables when no colours are worn", () => {
    const skin = toRenderable(sampleSkin());
    expect(markupOf(skin)).not.toContain("style=");
    expect(renderToStaticMarkup(<Sprite skin={skin} colours={[]} />)).toBe(markupOf(skin));
  });

  it("emits only svg, g and rect — there is nowhere for markup to appear", () => {
    const markup = markupOf(toRenderable(sampleSkin()));
    const tags = new Set([...markup.matchAll(/<([a-zA-Z-]+)/g)].map((m) => m[1]));
    expect([...tags].sort()).toEqual(["g", "rect", "svg"]);
  });

  it("merges the art into far fewer rects than painted cells", () => {
    const renderable = toRenderable(sampleSkin());
    const painted = PART_SLOTS.reduce(
      (sum, slot) => sum + gridFromArt(ART[slot]).filter((index) => index !== 0).length,
      0,
    );
    const rects = renderable.parts.reduce(
      (sum, part) => sum + (part.frames[0]?.rects.length ?? 0),
      0,
    );
    expect(rects).toBeLessThan(painted / 2);
  });

  it("wraps the frame index per part rather than running off the end", () => {
    const skin = toRenderable(sampleSkin());
    const first = markupOf(skin, 0);
    expect(markupOf(skin, 7)).toBe(first);
    expect(markupOf(skin, 1_000)).toBe(first);
  });

  it("makes a corrupt palette index obvious instead of drawing it silently", () => {
    // parseSkin rejects this, so it can only come from corrupt storage.
    const corrupt: RenderableSkin = {
      formatVersion: 1,
      palette: [{ id: "skin", hex: "#e8b98a" }],
      parts: [{ slot: "body", frames: [{ durationMs: 100, rects: [[0, 0, 4, 4, 9]] }] }],
    };
    expect(markupOf(corrupt)).toContain('fill="magenta"');
  });

  it("renders nothing for a part with no frames", () => {
    const empty: RenderableSkin = {
      formatVersion: 1,
      palette: [{ id: "skin", hex: "#e8b98a" }],
      parts: [{ slot: "body", frames: [] }],
    };
    expect(markupOf(empty)).not.toContain("<rect");
  });

  it("plays each part on its own clock when it is given a time", () => {
    expect(xsAt(0)).toEqual(["0", "10"]);
    expect(xsAt(100)).toEqual(["1", "10"]);
    expect(xsAt(200)).toEqual(["0", "10"]);
    expect(xsAt(300)).toEqual(["1", "11"]);
    // Both loops have come back round: the body every 200 ms, the hair every 600.
    expect(xsAt(600)).toEqual(["0", "10"]);
  });

  it("prefers the time over the frame number when it has both", () => {
    const byTime = renderToStaticMarkup(<Sprite skin={TWO_CLOCKS} frame={0} elapsedMs={100} />);
    expect([...byTime.matchAll(/<rect x="(\d+)"/g)].map((m) => m[1])).toEqual(["1", "10"]);
  });

  it("still goes by the frame number when there is no time", () => {
    const byFrame = renderToStaticMarkup(<Sprite skin={TWO_CLOCKS} frame={1} />);
    expect([...byFrame.matchAll(/<rect x="(\d+)"/g)].map((m) => m[1])).toEqual(["1", "11"]);
  });
});
