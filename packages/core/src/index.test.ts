import { describe, expect, it } from "vitest";

import { TILE_KINDS, canStandOn, canWalkTo, isWalkable, step, tileAt } from "./index.js";
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

describe("canWalkTo", () => {
  //        0123456
  //      0 ..T...w        the left room: (0,0) (1,0) (0,1) (1,1) (0,2) (1,2)
  //      1 ..T.g.w        the right room: everything between the trees and the water
  //      2 ..T...w
  const rooms = mapFromArt(["..T...w", "..T.g.w", "..T...w"]);
  const left: Position = { x: 0, y: 0 };
  const right: Position = { x: 4, y: 1 };

  it("says yes for the tile the player is already on", () => {
    expect(canWalkTo(rooms, left, { x: 0, y: 0 })).toBe(true);
  });

  it("says yes for a tile many steps away, when there is a way there", () => {
    expect(canWalkTo(rooms, left, { x: 1, y: 2 })).toBe(true);
    expect(canWalkTo(rooms, right, { x: 5, y: 2 })).toBe(true);
  });

  it("finds the way round an obstacle", () => {
    const map = mapFromArt([".T.", ".T.", "..."]);
    expect(canWalkTo(map, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(true);
  });

  it("says no for a tile on the far side of a wall with no gap in it", () => {
    expect(canWalkTo(rooms, left, right)).toBe(false);
    expect(canWalkTo(rooms, right, left)).toBe(false);
  });

  it("says yes again once the wall has a gap", () => {
    const open = mapFromArt(["..T...w", "....g.w", "..T...w"]);
    expect(canWalkTo(open, left, right)).toBe(true);
  });

  it.each([
    ["a tree", { x: 2, y: 1 }],
    ["water", { x: 6, y: 0 }],
    ["somewhere off the map", { x: 7, y: 0 }],
    ["somewhere between tiles", { x: 0.5, y: 0 }],
  ])("says no for %s, which nobody can stand on", (_label, to) => {
    expect(canWalkTo(rooms, left, to)).toBe(false);
  });

  it("says no from somewhere nobody can stand, even to the tile next to it", () => {
    expect(canWalkTo(rooms, { x: 2, y: 0 }, { x: 1, y: 0 })).toBe(false);
    expect(canWalkTo(rooms, { x: -1, y: 0 }, { x: 0, y: 0 })).toBe(false);
  });

  it("does not take tiles that only touch at a corner for a way through", () => {
    const map = mapFromArt([".T", "T."]);
    expect(canWalkTo(map, { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false);
  });

  it("does not wrap from the end of one row to the start of the next", () => {
    // (1,0) and (0,1) sit side by side in the flat array, and nowhere near on the grid.
    const map = mapFromArt(["T.", ".T"]);
    expect(canWalkTo(map, { x: 1, y: 0 }, { x: 0, y: 1 })).toBe(false);
  });

  it("changes neither the positions nor the map it was given", () => {
    const from = Object.freeze({ x: 0, y: 0 });
    const to = Object.freeze({ x: 1, y: 2 });
    const map: TileMap = Object.freeze({ ...rooms, tiles: Object.freeze([...rooms.tiles]) });
    expect(canWalkTo(map, from, to)).toBe(true);
  });

  it("agrees, on any map, with rooms worked out a different way", () => {
    const rand = mulberry32(0xc0ffee);
    let yes = 0;
    let no = 0;
    for (let n = 0; n < 100; n++) {
      const map = randomMap(rand);
      const all: Position[] = [];
      for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) all.push({ x, y });

      // Every standable tile starts as a room of its own; neighbours then keep
      // taking the smaller of their two numbers until nothing changes. Tiles
      // that end up with the same number are in the same room.
      const room = all.map((at, i) => (canStandOn(map, at) ? i : -1));
      for (let changed = true; changed;) {
        changed = false;
        for (const [i, at] of all.entries()) {
          if (room[i] === -1) continue;
          const beside = [
            at.x + 1 < map.width ? i + 1 : -1,
            at.y + 1 < map.height ? i + map.width : -1,
          ];
          for (const j of beside) {
            const [a, b] = [room[i] ?? -1, room[j] ?? -1];
            if (j === -1 || b === -1 || a === b) continue;
            room[i] = room[j] = Math.min(a, b);
            changed = true;
          }
        }
      }

      for (const [i, from] of all.entries()) {
        for (const [j, to] of all.entries()) {
          const same = room[i] !== -1 && room[i] === room[j];
          expect(canWalkTo(map, from, to)).toBe(same);
          if (same) yes++;
          else no++;
        }
      }
    }
    // Guards against the loop above only ever seeing one of the two answers.
    expect(yes).toBeGreaterThan(1000);
    expect(no).toBeGreaterThan(1000);
  });
});
