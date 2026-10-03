import { describe, expect, it } from "vitest";

import { TILE_KINDS, canStandOn, isWalkable, step, tileAt } from "./index.js";
import type { Direction, Position, TileKind, TileMap } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEGEND: Record<string, TileKind> = { ".": "path", g: "grass", T: "tree", w: "water" };

/**
 * Maps are written as ASCII art so the layout is readable in the test: one
 * string per row, one character per tile.
 */
function mapFromArt(rows: string[]): TileMap {
  const width = rows[0]?.length ?? 0;
  const tiles = rows.flatMap((row) => {
    if (row.length !== width) throw new Error(`ragged fixture: "${row}"`);
    return [...row].map((char) => {
      const kind = LEGEND[char];
      if (kind === undefined) throw new Error(`unknown tile "${char}"`);
      return kind;
    });
  });
  return { width, height: rows.length, tiles };
}

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

const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];

function randomMap(rand: () => number): TileMap {
  const width = 1 + Math.floor(rand() * 8);
  const height = 1 + Math.floor(rand() * 8);
  const tiles = Array.from(
    { length: width * height },
    () => TILE_KINDS[Math.floor(rand() * TILE_KINDS.length)] ?? "path",
  );
  return { width, height, tiles };
}

/** 3×3 of open ground. The centre can move in every direction. */
const OPEN = mapFromArt(["...", "...", "..."]);

// ---------------------------------------------------------------------------

describe("isWalkable", () => {
  it("lets a player onto paths and grass, and keeps them out of trees and water", () => {
    expect(isWalkable("path")).toBe(true);
    expect(isWalkable("grass")).toBe(true);
    expect(isWalkable("tree")).toBe(false);
    expect(isWalkable("water")).toBe(false);
  });

  it("has an answer for every kind there is", () => {
    for (const kind of TILE_KINDS) expect(typeof isWalkable(kind)).toBe("boolean");
  });
});

describe("tileAt", () => {
  // Asymmetric on purpose: swapping x and y, or rows and columns, reads the wrong tile.
  const map = mapFromArt([".gT", "w.."]);

  it("reads row-major: x across, y down", () => {
    expect(tileAt(map, { x: 0, y: 0 })).toBe("path");
    expect(tileAt(map, { x: 1, y: 0 })).toBe("grass");
    expect(tileAt(map, { x: 2, y: 0 })).toBe("tree");
    expect(tileAt(map, { x: 0, y: 1 })).toBe("water");
    expect(tileAt(map, { x: 2, y: 1 })).toBe("path");
  });

  it.each([
    ["left of the map", { x: -1, y: 0 }],
    ["above the map", { x: 0, y: -1 }],
    ["right of the map", { x: 3, y: 0 }],
    ["below the map", { x: 0, y: 2 }],
    ["between tiles", { x: 0.5, y: 0 }],
    ["nowhere at all", { x: Number.NaN, y: 0 }],
  ])("is undefined %s", (_label, at) => {
    expect(tileAt(map, at)).toBeUndefined();
  });

  it("does not wrap past the end of a row into the next one", () => {
    // tiles[0 * 3 + 3] is the first tile of row 1. It exists; (3, 0) does not.
    expect(map.tiles[3]).toBe("water");
    expect(tileAt(map, { x: 3, y: 0 })).toBeUndefined();
  });
});

describe("canStandOn", () => {
  const map = mapFromArt([".gT", "w.."]);

  it("accepts walkable tiles on the map", () => {
    expect(canStandOn(map, { x: 0, y: 0 })).toBe(true);
    expect(canStandOn(map, { x: 1, y: 0 })).toBe(true);
  });

  it("rejects blocking tiles, and anywhere that is not on the map", () => {
    expect(canStandOn(map, { x: 2, y: 0 })).toBe(false);
    expect(canStandOn(map, { x: 0, y: 1 })).toBe(false);
    expect(canStandOn(map, { x: 9, y: 9 })).toBe(false);
    expect(canStandOn(map, { x: -1, y: 0 })).toBe(false);
  });
});

describe("step", () => {
  const centre: Position = { x: 1, y: 1 };

  it.each([
    ["up", { x: 1, y: 0 }],
    ["down", { x: 1, y: 2 }],
    ["left", { x: 0, y: 1 }],
    ["right", { x: 2, y: 1 }],
  ] as const)("moves one tile %s on open ground", (dir, expected) => {
    expect(step(centre, dir, OPEN)).toEqual(expected);
  });

  it("walks onto grass", () => {
    const map = mapFromArt([".g"]);
    expect(step({ x: 0, y: 0 }, "right", map)).toEqual({ x: 1, y: 0 });
  });

  it.each([
    ["a tree", "T"],
    ["water", "w"],
  ])("is stopped by %s, and hands back the very position it was given", (_label, tile) => {
    const map = mapFromArt([`.${tile}`]);
    const from: Position = { x: 0, y: 0 };
    expect(step(from, "right", map)).toBe(from);
  });

  it.each([
    ["up", { x: 1, y: 0 }],
    ["down", { x: 1, y: 2 }],
    ["left", { x: 0, y: 1 }],
    ["right", { x: 2, y: 1 }],
  ] as const)("is stopped by the %s edge of the map", (dir, from) => {
    expect(step(from, dir, OPEN)).toBe(from);
  });

  it("does not wrap from the end of one row to the start of the next", () => {
    const map = mapFromArt(["...", "..."]);
    const rightEdge: Position = { x: 2, y: 0 };
    expect(step(rightEdge, "right", map)).toBe(rightEdge);
    const leftEdge: Position = { x: 0, y: 1 };
    expect(step(leftEdge, "left", map)).toBe(leftEdge);
  });

  it("follows a route around an obstacle", () => {
    const map = mapFromArt([".T.", "...", ".w."]);
    const route: Direction[] = ["right", "down", "right", "right", "up", "up"];
    const end = route.reduce((at, dir) => step(at, dir, map), { x: 0, y: 0 });
    expect(end).toEqual({ x: 2, y: 0 });
  });

  it("changes neither the position nor the map it was given", () => {
    const from = Object.freeze({ x: 1, y: 1 });
    const map: TileMap = Object.freeze({ ...OPEN, tiles: Object.freeze([...OPEN.tiles]) });
    expect(() => step(from, "up", map)).not.toThrow();
    expect(from).toEqual({ x: 1, y: 1 });
  });

  it("never leaves a player somewhere they cannot stand, whatever the map and the route", () => {
    const rand = mulberry32(0x5eed);
    let walks = 0;
    for (let n = 0; n < 400; n++) {
      const map = randomMap(rand);
      const start = { x: Math.floor(rand() * map.width), y: Math.floor(rand() * map.height) };
      if (!canStandOn(map, start)) continue;
      walks++;

      let at: Position = start;
      for (let i = 0; i < 40; i++) {
        const dir = DIRECTIONS[Math.floor(rand() * DIRECTIONS.length)] ?? "up";
        const next = step(at, dir, map);

        expect(canStandOn(map, next)).toBe(true);
        // Either it stayed put, or it moved exactly one tile along one axis.
        const moved = Math.abs(next.x - at.x) + Math.abs(next.y - at.y);
        expect(next === at ? moved === 0 : moved === 1).toBe(true);
        at = next;
      }
    }
    // Guards against the loop above silently testing nothing.
    expect(walks).toBeGreaterThan(100);
  });
});
