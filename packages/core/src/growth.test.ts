import { describe, expect, it } from "vitest";

import {
  GROWTH,
  combatantOf,
  expFor,
  expToReach,
  grown,
  levelOf,
  playTurn,
  settle,
  startBattle,
  statAt,
  viewMonster,
  wildCombatant,
} from "./index.js";
import type { BattleState, Combatant, FinishedBattle, OwnedMonster, Species } from "./index.js";

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
    expect(viewMonster(monster({ exp: 12, damage: 3 }), null)).toEqual({
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
      battleId: null,
    });
  });

  it("says which battle the monster is in the middle of, when it is in one", () => {
    expect(viewMonster(monster(), "battle-7").battleId).toBe("battle-7");
  });

  it("shows it by its nickname when it has one", () => {
    expect(viewMonster(monster({ nickname: "こけまる" }), null).name).toBe("こけまる");
  });

  it("says there is no next level at the top", () => {
    const top = viewMonster(monster({ exp: expToReach(GROWTH.maxLevel) }), null);
    expect(top.level).toBe(GROWTH.maxLevel);
    expect(top.nextLevelAt).toBeNull();
  });

  it("says where the next level begins one level below the top", () => {
    const almost = viewMonster(monster({ exp: expToReach(GROWTH.maxLevel) - 1 }), null);
    expect(almost.level).toBe(GROWTH.maxLevel - 1);
    expect(almost.nextLevelAt).toBe(expToReach(GROWTH.maxLevel));
  });

  it("hands out copies of the moves, not the species' own", () => {
    const view = viewMonster(monster(), null);
    expect(view.moves).toEqual(MOSS.moves);
    expect(view.moves).not.toBe(MOSS.moves);
    expect(view.moves[0]).not.toBe(MOSS.moves[0]);
  });
});

// ---------------------------------------------------------------------------
// What a battle leaves behind
// ---------------------------------------------------------------------------

/** A wild one that is worth 9: (20 + 10 + 8) / 4, rounded down. */
const DROP: Species = {
  id: "drop",
  name: "ヌマダマ",
  maxHp: 20,
  attack: 10,
  defense: 8,
  skinId: "species-drop",
  moves: [{ id: "bump", name: "ぶつかる", power: 5 }],
};

/** A battle that is over, with the player's monster left on `hp` out of what it went in with. */
function finished(
  status: "won" | "lost",
  mine: OwnedMonster,
  left: Partial<Combatant> = {},
  enemy: Partial<Combatant> = {},
): FinishedBattle {
  const state = startBattle(combatantOf(mine), wildCombatant(DROP));
  return {
    ...state,
    turn: 4,
    status,
    player: { ...state.player, ...(status === "lost" ? { hp: 0 } : {}), ...left },
    enemy: { ...state.enemy, ...(status === "won" ? { hp: 0 } : {}), ...enemy },
  };
}

describe("expFor", () => {
  it("is a quarter of the enemy's three numbers put together, rounded down", () => {
    expect(expFor({ maxHp: 20, attack: 10, defense: 8 })).toBe(9); // 38 / 4
    expect(expFor({ maxHp: 24, attack: 9, defense: 9 })).toBe(10); // 42 / 4
    expect(expFor({ maxHp: 28, attack: 8, defense: 12 })).toBe(12);
  });

  it("is more for an enemy that is sturdier or hits harder", () => {
    const base = expFor({ maxHp: 20, attack: 10, defense: 8 });
    expect(expFor({ maxHp: 40, attack: 10, defense: 8 })).toBeGreaterThan(base);
    expect(expFor({ maxHp: 20, attack: 30, defense: 8 })).toBeGreaterThan(base);
    expect(expFor({ maxHp: 20, attack: 10, defense: 28 })).toBeGreaterThan(base);
  });

  it("is at least 1, so that a win is always worth something", () => {
    expect(expFor({ maxHp: 1, attack: 1, defense: 1 })).toBe(1);
    expect(expFor({ maxHp: 0, attack: 0, defense: 0 })).toBe(1);
    expect(expFor({ maxHp: Number.NaN, attack: 1, defense: 1 })).toBe(1);
  });

  it("goes by the numbers the enemy fought with, not by how much health it has left", () => {
    const fresh = wildCombatant(DROP);
    const beaten: Combatant = { ...fresh, hp: 0 };
    expect(expFor(beaten)).toBe(expFor(fresh));
  });
});

describe("settle", () => {
  it("cannot be asked for while the battle is still going", () => {
    const state = startBattle(combatantOf(monster()), wildCombatant(DROP));
    // There is nothing to settle yet, and no way to ask. This function is
    // never called; it is here for `tsc`, which fails on a `@ts-expect-error`
    // with nothing to suppress.
    const attempt = () => {
      // @ts-expect-error — only a battle that is over can be settled
      settle(monster(), state);
    };
    expect(attempt).toBeTypeOf("function");
  });

  describe("a win", () => {
    it("adds what the enemy was worth to the monster's experience", () => {
      const mine = monster({ exp: 3 });
      const settled = settle(mine, finished("won", mine, { hp: 15 }));
      expect(settled.exp).toBe(12);
    });

    it("keeps the damage: what the monster has left is what it takes into its next battle", () => {
      const mine = monster();
      const settled = settle(mine, finished("won", mine, { hp: 15 }));
      expect(settled.damage).toBe(9);
      expect(grown({ ...mine, ...settled }).hp).toBe(15);
    });

    it("adds to the damage a monster went in with, and does not start the count again", () => {
      // In on 18 of 24, out on 11: 13 lost in all.
      const mine = monster({ damage: 6 });
      const settled = settle(mine, finished("won", mine, { hp: 11 }));
      expect(settled.damage).toBe(13);
    });

    it("leaves no damage after a win without a scratch", () => {
      const mine = monster();
      expect(settle(mine, finished("won", mine)).damage).toBe(0);
    });

    it("reports the experience, and no level when it did not change", () => {
      const mine = monster();
      expect(settle(mine, finished("won", mine)).events).toEqual([
        { kind: "exp_gained", amount: 9 },
      ]);
    });

    it("reports the new level, after the experience that brought it", () => {
      const mine = monster({ exp: 5 });
      const settled = settle(mine, finished("won", mine, { hp: 15 }));
      expect(settled.exp).toBe(14);
      expect(settled.events).toEqual([
        { kind: "exp_gained", amount: 9 },
        { kind: "level_up", level: 2 },
      ]);
    });

    it("reports the level it ends on, when one win is worth several", () => {
      const mine = monster();
      const giant = { maxHp: 999, attack: 999, defense: 999 };
      const settled = settle(mine, finished("won", mine, {}, giant));
      expect(settled.exp).toBe(749);
      expect(settled.events).toEqual([
        { kind: "exp_gained", amount: 749 },
        { kind: "level_up", level: levelOf(749) },
      ]);
    });

    it("gives the monster, on levelling up, the health its maximum gained", () => {
      const mine = monster({ exp: 5 });
      const settled = settle(mine, finished("won", mine, { hp: 15 }));
      // 9 lost at level 1 (24 at most). At level 2 the most is 26, so 17 are left.
      expect(grown({ ...mine, ...settled })).toMatchObject({ level: 2, maxHp: 26, hp: 17 });
    });

    it("pays what the enemy was when the battle began: the snapshot, not the species", () => {
      const mine = monster();
      const state = finished("won", mine);
      DROP.maxHp = 999;
      try {
        expect(settle(mine, state).exp).toBe(9);
      } finally {
        DROP.maxHp = 20;
      }
    });

    it("stops the experience where the top level begins, and then has nothing to report", () => {
      const most = expToReach(GROWTH.maxLevel);
      const nearly = monster({ exp: most - 4 });
      expect(settle(nearly, finished("won", nearly))).toMatchObject({
        exp: most,
        events: [
          { kind: "exp_gained", amount: 4 },
          { kind: "level_up", level: GROWTH.maxLevel },
        ],
      });

      const there = monster({ exp: most });
      expect(settle(there, finished("won", there))).toMatchObject({ exp: most, events: [] });
    });

    it("never takes experience away, even from a monster that is somehow past the top", () => {
      const beyond = monster({ exp: expToReach(GROWTH.maxLevel) + 500 });
      expect(settle(beyond, finished("won", beyond)).exp).toBe(beyond.exp);
    });
  });

  describe("a loss", () => {
    it("earns nothing, and has nothing to report", () => {
      const mine = monster({ exp: 7 });
      expect(settle(mine, finished("lost", mine))).toMatchObject({ exp: 7, events: [] });
    });

    it("restores the monster to full health, whatever it went in with", () => {
      const mine = monster({ exp: 40, damage: 20 });
      const settled = settle(mine, finished("lost", mine));
      expect(settled.damage).toBe(0);
      expect(grown({ ...mine, ...settled })).toMatchObject({ maxHp: 28, hp: 28 });
    });
  });

  it("changes nothing it was given", () => {
    const mine = Object.freeze(monster({ exp: 5 }));
    const state = finished("won", mine, { hp: 15 });
    const before = JSON.stringify(state);
    settle(mine, state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("settles a battle as it was actually played, turn by turn", () => {
    const mine = monster();
    let state: BattleState = startBattle(combatantOf(mine), wildCombatant(DROP));
    for (let turn = 0; turn < 50 && state.status === "ongoing"; turn++) {
      const result = playTurn(state, "bite", { playerVariance: 1, enemyMove: 0, enemyVariance: 0 });
      if (!result.ok) throw new Error("the turn was refused");
      state = result.value.state;
    }
    expect(state.status).toBe("won");
    // Said again for the compiler: `settle` takes a battle that is over, and
    // the line above is not something it can read.
    if (state.status === "ongoing") throw new Error("the battle did not end");

    const settled = settle(mine, state);
    expect(settled.exp).toBe(9);
    expect(settled.damage).toBe(24 - state.player.hp);
    expect(settled.damage).toBeGreaterThan(0);
  });
});
