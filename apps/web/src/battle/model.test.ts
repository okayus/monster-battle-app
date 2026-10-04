import { describe, expect, it } from "vitest";

import type { BattleView, TurnOutcome } from "@mba/core";

import type { ApiError } from "../api.js";
import { fight, isBehind, isGoingOn, namesOf, opened } from "./model.js";
import type { Fight } from "./model.js";

const BITE = { id: "bite", name: "かじる", power: 6 };

function battle(overrides: Partial<BattleView> = {}): BattleView {
  return {
    id: "battle-1",
    turn: 0,
    status: "ongoing",
    player: {
      name: "モリダマ",
      skinId: "species-moss",
      level: 2,
      hp: 24,
      maxHp: 26,
      moves: [BITE],
    },
    enemy: { name: "ヌマダマ", skinId: "species-drop", level: 1, hp: 20, maxHp: 20 },
    ...overrides,
  };
}

/** What the server says after one exchange of blows. */
function exchange(before: BattleView): TurnOutcome {
  return {
    battle: {
      ...before,
      turn: before.turn + 1,
      player: { ...before.player, hp: before.player.hp - 4 },
      enemy: { ...before.enemy, hp: before.enemy.hp - 6 },
    },
    events: [
      { kind: "attack", by: "player", move: "かじる", damage: 6 },
      { kind: "attack", by: "enemy", move: "ぶつかる", damage: 4 },
    ],
  };
}

const STALE: ApiError = { kind: "stale_turn", status: 400 };

function sent(state: Fight): Fight {
  return fight(state, { kind: "move_sent" });
}

// ---------------------------------------------------------------------------

describe("opening a battle", () => {
  it("starts with the battle as the server described it, and nothing else", () => {
    const view = battle();
    expect(opened(view)).toEqual({ battle: view, log: [], waiting: false, refused: null });
  });
});

describe("the names in the log", () => {
  it("mark the enemy as wild, so a fight between two of a kind can be followed", () => {
    const twins = battle({ enemy: { ...battle().enemy, name: "モリダマ" } });
    expect(namesOf(twins)).toEqual({ player: "モリダマ", enemy: "やせいの モリダマ" });
  });
});

describe("sending a move", () => {
  it("waits for the answer", () => {
    expect(sent(opened(battle())).waiting).toBe(true);
  });

  it("takes down the refusal that was showing", () => {
    const refused = fight(sent(opened(battle())), { kind: "turn_refused", error: STALE });
    expect(refused.refused).toEqual(STALE);
    expect(sent(refused).refused).toBeNull();
  });

  it("leaves the battle and the log alone", () => {
    const before = fight(sent(opened(battle())), {
      kind: "turn_played",
      outcome: exchange(battle()),
    });
    const after = sent(before);
    expect(after.battle).toBe(before.battle);
    expect(after.log).toBe(before.log);
  });
});

describe("a turn the server played", () => {
  const first = exchange(battle());
  const afterOne = () => fight(sent(opened(battle())), { kind: "turn_played", outcome: first });

  it("shows the battle as the server now describes it, and stops waiting", () => {
    const state = afterOne();
    expect(state.battle).toBe(first.battle);
    expect(state.waiting).toBe(false);
    expect(state.refused).toBeNull();
  });

  it("says what happened, in the order it happened", () => {
    expect(afterOne().log).toEqual([
      "モリダマ の かじる！ やせいの ヌマダマ に 6 のダメージ",
      "やせいの ヌマダマ の ぶつかる！ モリダマ に 4 のダメージ",
    ]);
  });

  it("adds to what was said before, at the end", () => {
    const second: TurnOutcome = {
      battle: { ...first.battle, turn: 2, status: "won", enemy: { ...first.battle.enemy, hp: 0 } },
      events: [
        { kind: "attack", by: "player", move: "かじる", damage: 14 },
        { kind: "fainted", who: "enemy" },
        { kind: "exp_gained", amount: 9 },
      ],
    };
    const state = fight(sent(afterOne()), { kind: "turn_played", outcome: second });
    expect(state.log).toEqual([
      "モリダマ の かじる！ やせいの ヌマダマ に 6 のダメージ",
      "やせいの ヌマダマ の ぶつかる！ モリダマ に 4 のダメージ",
      "モリダマ の かじる！ やせいの ヌマダマ に 14 のダメージ",
      "やせいの ヌマダマ は たおれた",
      "モリダマ は 経験値を 9 手に入れた",
    ]);
    expect(isGoingOn(state)).toBe(false);
  });

  it("does not change the state it was given", () => {
    const before = sent(opened(battle()));
    const copy = structuredClone(before);
    fight(before, { kind: "turn_played", outcome: first });
    expect(before).toEqual(copy);
  });
});

describe("a turn the server refused", () => {
  const refused = () =>
    fight(sent(opened(battle())), { kind: "turn_refused", error: { kind: "network" } });

  it("says why, stops waiting, and leaves the battle and the log as they were", () => {
    const before = opened(battle());
    const state = fight(sent(before), { kind: "turn_refused", error: { kind: "network" } });
    expect(state).toEqual({ ...before, refused: { kind: "network" } });
  });

  it("leaves the moves there to be chosen again", () => {
    expect(isGoingOn(refused())).toBe(true);
    expect(refused().waiting).toBe(false);
  });

  it("means the screen is behind only when the server says the turn was already played", () => {
    expect(isBehind(STALE)).toBe(true);
    expect(isBehind({ kind: "network" })).toBe(false);
    expect(isBehind({ kind: "unknown_move", status: 400 })).toBe(false);
    expect(isBehind({ kind: "battle_over", status: 400 })).toBe(false);
  });
});

describe("catching up with the server", () => {
  it("takes the battle as it is now, and keeps what this screen saw and why it was refused", () => {
    const played = fight(sent(opened(battle())), {
      kind: "turn_played",
      outcome: exchange(battle()),
    });
    const refused = fight(sent(played), { kind: "turn_refused", error: STALE });

    // Two more turns were played somewhere else.
    const now = battle({ turn: 3, status: "won", enemy: { ...battle().enemy, hp: 0 } });
    const state = fight(refused, { kind: "caught_up", battle: now });

    expect(state.battle).toBe(now);
    expect(state.log).toEqual(played.log);
    expect(state.refused).toEqual(STALE);
    expect(isGoingOn(state)).toBe(false);
  });
});

describe("whether there are moves to choose from", () => {
  it("is yes while the battle is going on, and no once it is won or lost", () => {
    expect(isGoingOn(opened(battle()))).toBe(true);
    expect(isGoingOn(opened(battle({ status: "won" })))).toBe(false);
    expect(isGoingOn(opened(battle({ status: "lost" })))).toBe(false);
  });
});
