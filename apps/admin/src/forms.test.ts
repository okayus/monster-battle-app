import { describe, expect, it } from "vitest";

import { checkMap, checkSpecies } from "@mba/core";
import type { AdminMap, Species } from "@mba/core";

import {
  blankMapForm,
  blankSpeciesForm,
  mapFormOf,
  moveSpawn,
  paintTile,
  setWeight,
  speciesFormOf,
  toMapInput,
  toSpeciesInput,
  toggleMove,
} from "./forms.js";

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

/** 3×2: a path along the top, grass, then a tree and water below. */
const POND: AdminMap = {
  id: "pond",
  name: "ちいさな池",
  width: 3,
  height: 2,
  tiles: ["path", "path", "grass", "tree", "water", "path"],
  spawn: { x: 0, y: 0 },
  encounters: [
    { speciesId: "drop", weight: 3 },
    { speciesId: "moss", weight: 5 },
  ],
};

describe("the species form", () => {
  it("sends back exactly what it was loaded with, if nothing is edited", () => {
    expect(toSpeciesInput(speciesFormOf(MOSS))).toEqual({
      name: "モリダマ",
      maxHp: 24,
      attack: 9,
      defense: 9,
      skinId: "species-moss",
      moveIds: ["bite", "bump"],
    });
  });

  it("produces something the rules accept, for a species loaded from the API", () => {
    expect(checkSpecies(toSpeciesInput(speciesFormOf(MOSS))).ok).toBe(true);
  });

  it("starts a new species with stats the rules accept, and waits for a name and a move", () => {
    const blank = blankSpeciesForm("species-moss");
    expect(blank.id).toBeNull();
    expect(checkSpecies(toSpeciesInput(blank))).toEqual({ ok: false, error: { kind: "bad_name" } });

    const filled = toggleMove({ ...blank, name: "あたらしい" }, "bump");
    expect(checkSpecies(toSpeciesInput(filled)).ok).toBe(true);
  });

  it("trims the name it sends", () => {
    expect(toSpeciesInput({ ...speciesFormOf(MOSS), name: "  コケ  " }).name).toBe("コケ");
  });

  it("ticks and unticks a move without touching the form it was given", () => {
    const form = speciesFormOf(MOSS);
    const without = toggleMove(form, "bite");
    const withFling = toggleMove(form, "fling");

    expect(without.moveIds).toEqual(["bump"]);
    expect(withFling.moveIds).toEqual(["bite", "bump", "fling"]);
    expect(form.moveIds).toEqual(["bite", "bump"]);
  });
});

describe("the map form", () => {
  it("sends back exactly what it was loaded with, if nothing is edited", () => {
    const { id: _id, ...input } = POND;
    expect(toMapInput(mapFormOf(POND))).toEqual(input);
  });

  it("starts a new map as something the rules accept once it has a name", () => {
    const blank = blankMapForm();
    expect(blank.id).toBeNull();
    expect(blank.tiles).toHaveLength(blank.width * blank.height);
    expect(checkMap(toMapInput({ ...blank, name: "あたらしい" })).ok).toBe(true);
  });

  it("leaves out the species that do not turn up", () => {
    let form = mapFormOf(POND);
    form = setWeight(form, "drop", 0);
    form = setWeight(form, "rock", 2);
    form = setWeight(form, "ghost", Number.NaN);
    expect(toMapInput(form).encounters).toEqual([
      { speciesId: "moss", weight: 5 },
      { speciesId: "rock", weight: 2 },
    ]);
  });

  it("does not share the tile array with the map it was loaded from", () => {
    const form = mapFormOf(POND);
    form.tiles[0] = "water";
    expect(POND.tiles[0]).toBe("path");
  });
});

describe("paintTile", () => {
  const form = mapFormOf(POND);

  it("paints one tile into a new form, leaving the old one alone", () => {
    const painted = paintTile(form, 1, "water");
    expect(painted.tiles).toEqual(["path", "water", "grass", "tree", "water", "path"]);
    expect(form.tiles[1]).toBe("path");
    expect(painted).not.toBe(form);
  });

  it("hands back the very same form when the tile already has that kind", () => {
    expect(paintTile(form, 1, "path")).toBe(form);
  });

  it("ignores a position that is not on the map", () => {
    expect(paintTile(form, -1, "water")).toBe(form);
    expect(paintTile(form, 6, "water")).toBe(form);
  });

  it("will not put something unwalkable under the spawn", () => {
    expect(paintTile(form, 0, "tree")).toBe(form);
    expect(paintTile(form, 0, "water")).toBe(form);
    expect(paintTile(form, 0, "grass").tiles[0]).toBe("grass");
  });

  it("never produces a map the rules reject, whatever is painted", () => {
    let painted = form;
    const kinds = ["tree", "water", "grass", "path"] as const;
    for (let n = 0; n < 200; n++) {
      painted = paintTile(painted, (n * 7) % 6, kinds[(n * 3) % kinds.length] ?? "path");
      expect(checkMap(toMapInput(painted)).ok).toBe(true);
    }
  });
});

describe("moveSpawn", () => {
  const form = mapFormOf(POND);

  it("moves the spawn to a tile a player can stand on", () => {
    expect(moveSpawn(form, 2).spawn).toEqual({ x: 2, y: 0 });
    expect(moveSpawn(form, 5).spawn).toEqual({ x: 2, y: 1 });
  });

  it("stays put for a tree, water, or anywhere off the map", () => {
    expect(moveSpawn(form, 3)).toBe(form);
    expect(moveSpawn(form, 4)).toBe(form);
    expect(moveSpawn(form, 99)).toBe(form);
    expect(moveSpawn(form, -1)).toBe(form);
  });

  it("hands back the same form when the spawn is already there", () => {
    expect(moveSpawn(form, 0)).toBe(form);
  });
});
