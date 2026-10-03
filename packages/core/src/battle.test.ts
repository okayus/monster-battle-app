import { describe, expect, it } from "vitest";

import {
  TILE_KINDS,
  calcDamage,
  combatantOf,
  hasWildMonsters,
  pickWeighted,
  playTurn,
  startBattle,
  viewBattle,
} from "./index.js";
import type { BattleState, Combatant, Move, Species, TurnRolls } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Frozen: these are shared by every test, so a test that edits one by accident
// fails on the spot instead of quietly changing the damage in the tests after it.
const BUMP: Move = Object.freeze({ id: "bump", name: "ぶつかる", power: 5 });
const BITE: Move = Object.freeze({ id: "bite", name: "かじる", power: 6 });

function species(overrides: Partial<Species> = {}): Species {
  return {
    id: "test",
    name: "テスト",
    maxHp: 20,
    attack: 10,
    defense: 10,
    skinId: "skin-test",
    // Fresh copies, so a test may edit its own species freely.
    moves: [{ ...BUMP }, { ...BITE }],
    ...overrides,
  };
}

function combatant(overrides: Partial<Combatant> = {}): Combatant {
  return { ...combatantOf(species()), ...overrides };
}

/** Even stats on both sides, so the damage is just the move's power times the spread. */
function evenBattle(player: Partial<Combatant> = {}, enemy: Partial<Combatant> = {}): BattleState {
  return startBattle(
    combatant({ name: "こちら", ...player }),
    combatant({ name: "あいて", moves: [BUMP], ...enemy }),
  );
}

/** The strongest possible turn: every hit lands in full, and the enemy uses its last move. */
const FULL: TurnRolls = { playerVariance: 1, enemyMove: 0.999, enemyVariance: 1 };

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

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

function played(state: BattleState, moveId: string, rolls: TurnRolls) {
  const result = playTurn(state, moveId, rolls);
  if (!result.ok)
    throw new Error(`expected the turn to be played: ${JSON.stringify(result.error)}`);
  return result.value;
}

// ---------------------------------------------------------------------------

describe("calcDamage", () => {
  const attacker = { attack: 10 };
  const defender = { defense: 10 };

  it("grows with the move's power and the attacker's attack, and shrinks with the defender's defense", () => {
    expect(calcDamage(attacker, defender, { power: 5 }, 1)).toBe(5);
    expect(calcDamage(attacker, defender, { power: 10 }, 1)).toBe(10);
    expect(calcDamage({ attack: 20 }, defender, { power: 5 }, 1)).toBe(10);
    expect(calcDamage(attacker, { defense: 20 }, { power: 5 }, 1)).toBe(2);
  });

  it("lands between 85% and 100% of the full damage, as the roll says", () => {
    const big = { power: 100 };
    expect(calcDamage(attacker, defender, big, 0)).toBe(85);
    expect(calcDamage(attacker, defender, big, 0.5)).toBe(92);
    expect(calcDamage(attacker, defender, big, 1)).toBe(100);
  });

  it("never does less for a higher roll", () => {
    let previous = 0;
    for (let roll = 0; roll <= 1; roll += 0.01) {
      const damage = calcDamage(attacker, defender, { power: 37 }, roll);
      expect(damage).toBeGreaterThanOrEqual(previous);
      previous = damage;
    }
  });

  it("always does at least 1, so a battle cannot go on forever", () => {
    expect(calcDamage({ attack: 1 }, { defense: 999 }, { power: 1 }, 0)).toBe(1);
  });

  it("draws nothing itself: the same inputs give the same damage", () => {
    const first = calcDamage(attacker, defender, { power: 37 }, 0.42);
    for (let n = 0; n < 20; n++) {
      expect(calcDamage(attacker, defender, { power: 37 }, 0.42)).toBe(first);
    }
  });

  it.each([
    ["a roll below the range", -5, 85],
    ["a roll above the range", 7, 100],
    ["a roll that is not a number", Number.NaN, 85],
  ])("pulls %s back into range", (_label, roll, expected) => {
    expect(calcDamage(attacker, defender, { power: 100 }, roll)).toBe(expected);
  });

  it("stays a usable number when the stats should never have been stored", () => {
    expect(calcDamage(attacker, { defense: 0 }, { power: 5 }, 1)).toBe(50);
    expect(calcDamage(attacker, defender, { power: Number.NaN }, 1)).toBe(1);
  });
});

describe("combatantOf", () => {
  it("starts at full health with the species' stats", () => {
    const fighter = combatantOf(species({ maxHp: 24, attack: 9, defense: 8 }));
    expect(fighter).toMatchObject({ name: "テスト", hp: 24, maxHp: 24, attack: 9, defense: 8 });
    expect(fighter.moves).toEqual([BUMP, BITE]);
  });

  it("goes by its nickname when it has one", () => {
    expect(combatantOf(species(), "まる").name).toBe("まる");
    expect(combatantOf(species(), null).name).toBe("テスト");
  });

  it("is a snapshot: editing the species afterwards does not reach it", () => {
    const kind = species();
    const fighter = combatantOf(kind);
    kind.attack = 999;
    const first = kind.moves[0];
    if (first === undefined) throw new Error("fixture has no moves");
    first.power = 999;

    expect(fighter.attack).toBe(10);
    expect(fighter.moves[0]?.power).toBe(5);
  });
});

describe("playTurn", () => {
  it("lets the player hit first, then the enemy answer", () => {
    const { state, events } = played(evenBattle(), "bite", FULL);

    expect(state.enemy.hp).toBe(14);
    expect(state.player.hp).toBe(15);
    expect(state.status).toBe("ongoing");
    expect(events).toEqual([
      { kind: "attack", by: "player", move: "かじる", damage: 6 },
      { kind: "attack", by: "enemy", move: "ぶつかる", damage: 5 },
    ]);
  });

  it("uses the rolls it was handed for both hits", () => {
    const weak: TurnRolls = { playerVariance: 0, enemyMove: 0, enemyVariance: 0 };
    const { state } = played(evenBattle({}, { moves: [{ ...BUMP, power: 100 }] }), "bite", weak);
    // 85% of 6 is 5.1, and 85% of 100 is 85: both rounded down.
    expect(state.enemy.hp).toBe(15);
    expect(state.player.hp).toBe(0);
  });

  it("lets the enemy's roll choose which move it uses", () => {
    const battle = evenBattle({}, { moves: [BUMP, BITE] });
    const first = played(battle, "bump", { ...FULL, enemyMove: 0 });
    const last = played(battle, "bump", { ...FULL, enemyMove: 0.999 });
    expect(first.events[1]).toMatchObject({ by: "enemy", move: "ぶつかる" });
    expect(last.events[1]).toMatchObject({ by: "enemy", move: "かじる" });
  });

  it("is won the moment the enemy faints, and the enemy does not get to answer", () => {
    const { state, events } = played(evenBattle({}, { hp: 3 }), "bite", FULL);

    expect(state.status).toBe("won");
    expect(state.enemy.hp).toBe(0);
    expect(state.player.hp).toBe(20);
    expect(events).toEqual([
      { kind: "attack", by: "player", move: "かじる", damage: 6 },
      { kind: "fainted", who: "enemy" },
    ]);
  });

  it("is lost when the enemy's answer brings the player down", () => {
    const { state, events } = played(evenBattle({ hp: 2 }), "bump", FULL);

    expect(state.status).toBe("lost");
    expect(state.player.hp).toBe(0);
    expect(events.at(-1)).toEqual({ kind: "fainted", who: "player" });
  });

  it("gives a turn to an enemy that has no moves, and nothing happens in it", () => {
    const { state, events } = played(evenBattle({}, { moves: [] }), "bump", FULL);
    expect(events).toHaveLength(1);
    expect(state.player.hp).toBe(20);
    expect(state.status).toBe("ongoing");
  });

  it("counts the turns", () => {
    const first = played(evenBattle(), "bump", FULL);
    const second = played(first.state, "bump", FULL);
    expect(evenBattle().turn).toBe(0);
    expect(first.state.turn).toBe(1);
    expect(second.state.turn).toBe(2);
  });

  it("refuses a move the player's monster does not know", () => {
    expect(playTurn(evenBattle(), "fly", FULL)).toEqual({
      ok: false,
      error: { kind: "unknown_move", moveId: "fly" },
    });
  });

  it.each(["won", "lost"] as const)("refuses to go on once the battle is %s", (status) => {
    const over = { ...evenBattle(), status };
    expect(playTurn(over, "bump", FULL)).toEqual({ ok: false, error: { kind: "battle_over" } });
  });

  it("returns a new state and leaves the one it was given alone", () => {
    const before = deepFreeze(evenBattle());
    const { state } = played(before, "bite", FULL);
    expect(state).not.toBe(before);
    expect(before.enemy.hp).toBe(20);
    expect(before.turn).toBe(0);
  });

  it("always reaches an end, with health and outcome that agree, whatever is rolled", () => {
    const rand = mulberry32(0xba771e);
    const outcomes = { won: 0, lost: 0 };

    for (let n = 0; n < 300; n++) {
      const stat = () => 1 + Math.floor(rand() * 30);
      let state = startBattle(
        combatantOf(species({ maxHp: stat(), attack: stat(), defense: stat() })),
        combatantOf(species({ maxHp: stat(), attack: stat(), defense: stat() })),
      );

      // Every hit does at least 1, so two monsters with at most 30 health each
      // cannot last longer than this.
      for (let turn = 0; turn < 61 && state.status === "ongoing"; turn++) {
        const moveId = rand() < 0.5 ? "bump" : "bite";
        state = played(state, moveId, {
          playerVariance: rand(),
          enemyMove: rand(),
          enemyVariance: rand(),
        }).state;

        for (const side of [state.player, state.enemy]) {
          expect(side.hp).toBeGreaterThanOrEqual(0);
          expect(side.hp).toBeLessThanOrEqual(side.maxHp);
        }
      }

      if (state.status === "won") {
        expect(state.enemy.hp).toBe(0);
        expect(state.player.hp).toBeGreaterThan(0);
        outcomes.won++;
      } else if (state.status === "lost") {
        expect(state.player.hp).toBe(0);
        expect(state.enemy.hp).toBeGreaterThan(0);
        outcomes.lost++;
      } else {
        throw new Error(`battle ${n} did not end`);
      }
    }

    // Guards against a loop that only ever exercises one ending.
    expect(outcomes.won).toBeGreaterThan(30);
    expect(outcomes.lost).toBeGreaterThan(30);
  });
});

describe("pickWeighted", () => {
  const entries = [
    { value: "a", weight: 1 },
    { value: "b", weight: 3 },
  ];

  it.each([
    [0, "a"],
    [0.249, "a"],
    [0.25, "b"],
    [0.999, "b"],
  ])("gives each entry a share of the rolls equal to its weight (roll %s)", (roll, expected) => {
    expect(pickWeighted(entries, roll)).toBe(expected);
  });

  it("never picks an entry with no weight", () => {
    const mixed = [
      { value: "zero", weight: 0 },
      { value: "yes", weight: 2 },
      { value: "negative", weight: -4 },
      { value: "nonsense", weight: Number.NaN },
    ];
    for (let roll = 0; roll <= 1; roll += 0.05) expect(pickWeighted(mixed, roll)).toBe("yes");
  });

  it("has nothing to pick when nothing has weight", () => {
    expect(pickWeighted([], 0.5)).toBeUndefined();
    expect(pickWeighted([{ value: "a", weight: 0 }], 0.5)).toBeUndefined();
  });

  it.each([
    ["exactly 1", 1, "b"],
    ["above the range", 3, "b"],
    ["below the range", -1, "a"],
    ["not a number", Number.NaN, "a"],
  ])("still picks something for a roll that is %s", (_label, roll, expected) => {
    expect(pickWeighted(entries, roll)).toBe(expected);
  });

  it("comes out in proportion over many rolls", () => {
    const rand = mulberry32(2026);
    const weighted = [
      { value: "common", weight: 5 },
      { value: "uncommon", weight: 3 },
      { value: "rare", weight: 2 },
    ];
    const counts: Record<string, number> = { common: 0, uncommon: 0, rare: 0 };
    const rolls = 20_000;
    for (let n = 0; n < rolls; n++) {
      const picked = pickWeighted(weighted, rand());
      if (picked !== undefined) counts[picked] = (counts[picked] ?? 0) + 1;
    }
    expect((counts.common ?? 0) / rolls).toBeCloseTo(0.5, 1);
    expect((counts.uncommon ?? 0) / rolls).toBeCloseTo(0.3, 1);
    expect((counts.rare ?? 0) / rolls).toBeCloseTo(0.2, 1);
  });
});

describe("hasWildMonsters", () => {
  it("puts wild monsters in the grass and nowhere else", () => {
    expect(TILE_KINDS.filter(hasWildMonsters)).toEqual(["grass"]);
  });
});

describe("viewBattle", () => {
  const state = evenBattle({}, { moves: [BUMP, BITE] });
  const view = viewBattle("battle-1", state);

  it("carries what the screen draws", () => {
    expect(view).toEqual({
      id: "battle-1",
      turn: 0,
      status: "ongoing",
      player: { name: "こちら", skinId: "skin-test", hp: 20, maxHp: 20, moves: [BUMP, BITE] },
      enemy: { name: "あいて", skinId: "skin-test", hp: 20, maxHp: 20 },
    });
  });

  it("leaves the numbers behind the judgement, and the enemy's moves, on the server", () => {
    const sent = JSON.stringify(view);
    expect(sent).not.toContain("attack");
    expect(sent).not.toContain("defense");
    expect(Object.keys(view.enemy).sort()).toEqual(["hp", "maxHp", "name", "skinId"]);
  });
});
