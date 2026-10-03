import { describe, expect, it } from "vitest";

import { GROWTH, expToReach, grown, levelOf, statAt, viewMonster } from "./index.js";
import type { OwnedMonster, Species } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOSS: Species = {
  id: "moss",
  name: "モリダマ",
  maxHp: 24,
  attack: 9,
  defense: 9,
  skinId: "species-moss",
  moves: [
    { id: "bite", name: "かじる", power: 6 },
    { id: "bump", name: "ぶつかる", power: 5 },
  ],
};

function monster(overrides: Partial<OwnedMonster> = {}): OwnedMonster {
  return { id: "m1", species: MOSS, nickname: null, exp: 0, damage: 0, ...overrides };
}

const LEVELS = Array.from({ length: GROWTH.maxLevel }, (_, i) => i + 1);

// ---------------------------------------------------------------------------

describe("expToReach", () => {
  it("starts level 1 with no experience at all", () => {
    expect(expToReach(1)).toBe(0);
  });

  it("asks for more and more: 10 for level 2, 40 for level 3, 90 for level 4", () => {
    expect([2, 3, 4].map(expToReach)).toEqual([10, 40, 90]);
  });

  it("asks for more at every level than at the one before, in whole numbers", () => {
    for (const level of LEVELS.slice(1)) {
      expect(expToReach(level)).toBeGreaterThan(expToReach(level - 1));
      expect(Number.isInteger(expToReach(level))).toBe(true);
    }
  });
});

describe("levelOf", () => {
  it.each([
    [0, 1],
    [9, 1],
    [10, 2],
    [39, 2],
    [40, 3],
    [89, 3],
    [90, 4],
  ])("puts %i experience at level %i", (exp, level) => {
    expect(levelOf(exp)).toBe(level);
  });

  it("goes up exactly where each level begins, and not one point sooner", () => {
    for (const level of LEVELS.slice(1)) {
      expect(levelOf(expToReach(level))).toBe(level);
      expect(levelOf(expToReach(level) - 1)).toBe(level - 1);
    }
  });

  it("stops at the top level, however much experience there is", () => {
    expect(levelOf(expToReach(GROWTH.maxLevel))).toBe(GROWTH.maxLevel);
    expect(levelOf(expToReach(GROWTH.maxLevel) * 1000)).toBe(GROWTH.maxLevel);
    expect(levelOf(Number.POSITIVE_INFINITY)).toBe(GROWTH.maxLevel);
  });

  it.each([
    ["a negative number", -5],
    ["not a number", Number.NaN],
  ])("is level 1, never less, for %s", (_label, exp) => {
    expect(levelOf(exp)).toBe(1);
  });
});

describe("statAt", () => {
  it("is the species' own number at level 1", () => {
    expect(statAt(24, 1)).toBe(24);
    expect(statAt(9, 1)).toBe(9);
  });

  it("is a tenth more for each level gained, rounded down", () => {
    expect(statAt(24, 2)).toBe(26); // 24 + 2.4
    expect(statAt(24, 3)).toBe(28); // 24 + 4.8
    expect(statAt(9, 2)).toBe(9); // 9 + 0.9
    expect(statAt(9, 3)).toBe(10); // 9 + 1.8
  });

  it("has doubled by level 11", () => {
    expect(statAt(24, 11)).toBe(48);
  });

  it("never goes down as the level goes up, and stays a whole number", () => {
    for (const base of [1, 9, 24, 999]) {
      for (const level of LEVELS.slice(1)) {
        expect(statAt(base, level)).toBeGreaterThanOrEqual(statAt(base, level - 1));
        expect(Number.isInteger(statAt(base, level))).toBe(true);
      }
    }
  });
});

describe("grown", () => {
  it("is the species at level 1, unhurt, for a monster that has earned and lost nothing", () => {
    expect(grown(monster())).toEqual({ level: 1, maxHp: 24, hp: 24, attack: 9, defense: 9 });
  });

  it("grows every number with the level its experience puts it at", () => {
    expect(grown(monster({ exp: 40 }))).toEqual({
      level: 3,
      maxHp: 28,
      hp: 28,
      attack: 10,
      defense: 10,
    });
  });

  it("has the health that is left: the most it could have, less what it has lost", () => {
    expect(grown(monster({ damage: 5 })).hp).toBe(19);
    expect(grown(monster({ exp: 40, damage: 5 })).hp).toBe(23);
  });

  it("gains, on levelling up, exactly the health its maximum gained", () => {
    const before = grown(monster({ exp: 39, damage: 7 }));
    const after = grown(monster({ exp: 40, damage: 7 }));
    expect(after.maxHp - before.maxHp).toBe(2);
    expect(after.hp - before.hp).toBe(2);
  });

  it.each([
    ["exactly as much damage as it has health", 24],
    ["more damage than it has health", 500],
  ])("is left standing on 1 with %s", (_label, damage) => {
    expect(grown(monster({ damage })).hp).toBe(1);
  });

  it("never has more health than its maximum, even with damage below zero", () => {
    expect(grown(monster({ damage: -10 })).hp).toBe(24);
  });

  it("is left on 1 by damage that is not a number, and not on NaN", () => {
    expect(grown(monster({ damage: Number.NaN })).hp).toBe(1);
  });

  it("follows the species: when its numbers are edited, the monster's change with them", () => {
    const sturdier = { ...MOSS, maxHp: 30, defense: 20 };
    expect(grown(monster({ species: sturdier, damage: 5 }))).toMatchObject({
      maxHp: 30,
      hp: 25,
      defense: 20,
    });
    // And an edit that takes the maximum below the damage already taken.
    const frail = { ...MOSS, maxHp: 4 };
    expect(grown(monster({ species: frail, damage: 5 }))).toMatchObject({ maxHp: 4, hp: 1 });
  });
});

describe("viewMonster", () => {
  it("shows a monster by its species' name, with what it has grown into", () => {
    expect(viewMonster(monster({ exp: 12, damage: 3 }))).toEqual({
      id: "m1",
      name: "モリダマ",
      skinId: "species-moss",
      level: 2,
      exp: 12,
      nextLevelAt: 40,
      hp: 23,
      maxHp: 26,
      attack: 9,
      defense: 9,
      moves: MOSS.moves,
    });
  });

  it("shows it by its nickname when it has one", () => {
    expect(viewMonster(monster({ nickname: "こけまる" })).name).toBe("こけまる");
  });

  it("says there is no next level at the top", () => {
    const top = viewMonster(monster({ exp: expToReach(GROWTH.maxLevel) }));
    expect(top.level).toBe(GROWTH.maxLevel);
    expect(top.nextLevelAt).toBeNull();
  });

  it("says where the next level begins one level below the top", () => {
    const almost = viewMonster(monster({ exp: expToReach(GROWTH.maxLevel) - 1 }));
    expect(almost.level).toBe(GROWTH.maxLevel - 1);
    expect(almost.nextLevelAt).toBe(expToReach(GROWTH.maxLevel));
  });

  it("hands out copies of the moves, not the species' own", () => {
    const view = viewMonster(monster());
    expect(view.moves).toEqual(MOSS.moves);
    expect(view.moves).not.toBe(MOSS.moves);
    expect(view.moves[0]).not.toBe(MOSS.moves[0]);
  });
});
