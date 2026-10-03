import { describe, expect, it } from "vitest";

import { describeEvent } from "./battle-log.js";

const names = { player: "モリダマ", enemy: "やせいの ヌマダマ" };

describe("describeEvent", () => {
  it("says who hit whom, with what, and for how much", () => {
    expect(describeEvent({ kind: "attack", by: "player", move: "かじる", damage: 6 }, names)).toBe(
      "モリダマ の かじる！ やせいの ヌマダマ に 6 のダメージ",
    );
    expect(describeEvent({ kind: "attack", by: "enemy", move: "ぶつかる", damage: 4 }, names)).toBe(
      "やせいの ヌマダマ の ぶつかる！ モリダマ に 4 のダメージ",
    );
  });

  it("says who went down", () => {
    expect(describeEvent({ kind: "fainted", who: "enemy" }, names)).toBe(
      "やせいの ヌマダマ は たおれた",
    );
    expect(describeEvent({ kind: "fainted", who: "player" }, names)).toBe("モリダマ は たおれた");
  });

  it("says what a win was worth, to the player's monster", () => {
    expect(describeEvent({ kind: "exp_gained", amount: 9 }, names)).toBe(
      "モリダマ は 経験値を 9 手に入れた",
    );
  });

  it("says which level the player's monster has reached", () => {
    expect(describeEvent({ kind: "level_up", level: 2 }, names)).toBe(
      "モリダマ は レベル 2 に上がった！",
    );
  });
});
