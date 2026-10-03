import { describe, expect, it } from "vitest";

import { explainRetireError, offered, withMark } from "./retire.js";

const MOVES = [
  { id: "bite", name: "かじる", retired: false },
  { id: "fling", name: "はねとばす", retired: true },
  { id: "bump", name: "ぶつかる", retired: false },
  { id: "peck", name: "つつく", retired: true },
];

describe("offered", () => {
  it("offers what is in use and leaves out what has been retired", () => {
    expect(offered(MOVES, []).map((move) => move.id)).toEqual(["bite", "bump"]);
  });

  it("still shows something retired that is chosen already, so that it can be unchosen", () => {
    expect(offered(MOVES, ["fling", "bite"]).map((move) => move.id)).toEqual([
      "bite",
      "fling",
      "bump",
    ]);
  });

  it("keeps the order it was given", () => {
    expect(offered(MOVES, ["peck", "fling"]).map((move) => move.id)).toEqual([
      "bite",
      "fling",
      "bump",
      "peck",
    ]);
  });
});

describe("withMark", () => {
  it("marks a retired name and leaves the others alone", () => {
    expect(withMark("かじる", false)).toBe("かじる");
    expect(withMark("かじる", true)).toBe("かじる（retire 済み）");
  });
});

describe("explainRetireError", () => {
  it("names what is using it, grouped by what they are", () => {
    const text = explainRetireError({
      kind: "in_use",
      status: 400,
      detail: {
        by: [
          { kind: "species", id: "rock", name: "イワダマ" },
          { kind: "species", id: "moss", name: "モリダマ" },
          { kind: "map", id: "start", name: "はじまりの草原" },
        ],
      },
    });
    expect(text).toContain("retire できない");
    expect(text).toContain("種族: イワダマ、モリダマ");
    expect(text).toContain("マップ: はじまりの草原");
  });

  it("names what would have to come back first", () => {
    const text = explainRetireError({
      kind: "depends_on_retired",
      status: 400,
      detail: { on: [{ kind: "move", id: "fling", name: "はねとばす" }] },
    });
    expect(text).toContain("戻せない");
    expect(text).toContain("技: はねとばす");
  });

  it("says why a protected one stays", () => {
    expect(explainRetireError({ kind: "protected", status: 400, detail: {} })).toContain("戻り先");
  });

  it("shows any other refusal as the API said it", () => {
    expect(explainRetireError({ kind: "not_found", status: 404, detail: {} })).toBe(
      "できなかった（not_found）",
    );
    expect(explainRetireError({ kind: "network" })).toBe("できなかった（network）");
  });

  it("does not trip over a detail that is not the shape it expects", () => {
    expect(explainRetireError({ kind: "in_use", detail: { by: "everything" } })).toContain(
      "retire できない",
    );
    expect(
      explainRetireError({ kind: "in_use", detail: { by: [null, 3, { kind: "species" }] } }),
    ).toContain("retire できない");
  });
});
