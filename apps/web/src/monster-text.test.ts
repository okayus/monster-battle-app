import { describe, expect, it } from "vitest";

import { describeProgress } from "./monster-text.js";

describe("describeProgress", () => {
  it("says how much experience there is, and how much more the next level takes", () => {
    expect(describeProgress({ exp: 12, nextLevelAt: 40 })).toBe(
      "経験値 12（つぎのレベルまで あと 28）",
    );
  });

  it("counts the whole way for a monster that has earned nothing", () => {
    expect(describeProgress({ exp: 0, nextLevelAt: 10 })).toBe(
      "経験値 0（つぎのレベルまで あと 10）",
    );
  });

  it("says so when there is no next level", () => {
    expect(describeProgress({ exp: 24010, nextLevelAt: null })).toBe(
      "経験値 24010（これ以上は上がらない）",
    );
  });
});
