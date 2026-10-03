import { describe, expect, it } from "vitest";

import { PART_SLOTS, parseAppearance } from "@mba/sprite";
import type { Appearance, RenderableSkin } from "@mba/sprite";

import {
  colourWorn,
  dye,
  skinsNamedBy,
  takePart,
  trimmed,
  undye,
  wear,
  withColour,
} from "./model.js";

const PLAIN: Appearance = { skinId: "a", parts: {}, colours: [] };

/** A recipe is what these functions make. It has to be one the server would take. */
function expectSendable(appearance: Appearance): void {
  const parsed = parseAppearance(JSON.parse(JSON.stringify(appearance)));
  expect(parsed).toEqual({ ok: true, value: appearance });
}

describe("skinsNamedBy", () => {
  it("names the worn skin alone when nothing is swapped", () => {
    expect(skinsNamedBy(PLAIN)).toEqual(["a"]);
  });

  it("names each skin once, however many slots are taken from it", () => {
    const look: Appearance = {
      skinId: "a",
      parts: { hair: "b", shoes: "b", shirt: "c" },
      colours: [],
    };
    expect(skinsNamedBy(look)).toEqual(["a", "c", "b"]);
  });
});

describe("wear", () => {
  it("changes the skin that is worn", () => {
    expect(wear(PLAIN, "b")).toEqual({ skinId: "b", parts: {}, colours: [] });
  });

  it("keeps the parts taken from other skins, and the colours", () => {
    const before: Appearance = {
      skinId: "a",
      parts: { hair: "c" },
      colours: [{ id: "hair", hex: "#cc3344" }],
    };
    expect(wear(before, "b")).toEqual({ ...before, skinId: "b" });
  });

  it("drops a swap that the new skin makes pointless", () => {
    const before: Appearance = { skinId: "a", parts: { hair: "b", shoes: "c" }, colours: [] };
    const after = wear(before, "b");
    expect(after).toEqual({ skinId: "b", parts: { shoes: "c" }, colours: [] });
    expectSendable(after);
  });

  it("does not change the recipe it was given", () => {
    const before: Appearance = { skinId: "a", parts: { hair: "b" }, colours: [] };
    wear(before, "b");
    expect(before).toEqual({ skinId: "a", parts: { hair: "b" }, colours: [] });
  });
});

describe("takePart", () => {
  it("takes one slot from another skin and leaves the others", () => {
    const before: Appearance = { skinId: "a", parts: { shoes: "c" }, colours: [] };
    const after = takePart(before, "hair", "b");
    expect(after).toEqual({ skinId: "a", parts: { shoes: "c", hair: "b" }, colours: [] });
    expectSendable(after);
  });

  it("replaces what the slot was taken from before", () => {
    const before: Appearance = { skinId: "a", parts: { hair: "b" }, colours: [] };
    expect(takePart(before, "hair", "c").parts).toEqual({ hair: "c" });
  });

  it("gives the slot back to the worn skin", () => {
    const before: Appearance = { skinId: "a", parts: { hair: "b", shoes: "c" }, colours: [] };
    expect(takePart(before, "hair", null).parts).toEqual({ shoes: "c" });
  });

  it("treats the worn skin's own part as no swap at all", () => {
    const after = takePart(PLAIN, "hair", "a");
    expect(after.parts).toEqual({});
    expectSendable(after);
  });

  it("writes the slots down in draw order, whatever order they were chosen in", () => {
    let look = PLAIN;
    for (const slot of [...PART_SLOTS].reverse()) look = takePart(look, slot, "b");
    expect(Object.keys(look.parts)).toEqual([...PART_SLOTS]);
    expectSendable(look);
  });
});

describe("colours", () => {
  it("adds a colour for an id that had none", () => {
    expect(dye(PLAIN, "hair", "#cc3344").colours).toEqual([{ id: "hair", hex: "#cc3344" }]);
  });

  it("replaces the colour of an id that had one, in place", () => {
    const dyed = dye(dye(dye(PLAIN, "hair", "#111111"), "shirt", "#222222"), "hair", "#333333");
    expect(dyed.colours).toEqual([
      { id: "hair", hex: "#333333" },
      { id: "shirt", hex: "#222222" },
    ]);
    expectSendable(dyed);
  });

  it("finds the colour worn for an id, and nothing for an id that was not chosen", () => {
    const colours = withColour([], "hair", "#cc3344");
    expect(colourWorn(colours, "hair")).toBe("#cc3344");
    expect(colourWorn(colours, "shirt")).toBeUndefined();
  });

  it("is not fooled by an id that every object has a property for", () => {
    expect(colourWorn([], "constructor")).toBeUndefined();
    expect(colourWorn(withColour([], "constructor", "#123456"), "constructor")).toBe("#123456");
  });

  it("goes back to the colours as drawn", () => {
    const dyed = dye(dye(PLAIN, "hair", "#111111"), "shirt", "#222222");
    expect(undye(dyed)).toEqual(PLAIN);
  });
});

describe("trimmed", () => {
  /** A look painted with "skin" and "hair". "shirt" is in the palette and on no cell. */
  const LOOK: RenderableSkin = {
    formatVersion: 1,
    palette: [
      { id: "skin", hex: "#e8b98a" },
      { id: "hair", hex: "#5a3921" },
      { id: "shirt", hex: "#3f7bd6" },
    ],
    parts: [
      { slot: "body", frames: [{ durationMs: 120, rects: [[0, 0, 1, 1, 1]] }] },
      { slot: "hair", frames: [{ durationMs: 120, rects: [[0, 1, 1, 1, 2]] }] },
    ],
  };

  it("keeps the colours the look is painted with", () => {
    const dyed = dye(dye(PLAIN, "hair", "#111111"), "skin", "#222222");
    expect(trimmed(dyed, LOOK)).toEqual(dyed);
  });

  it("leaves out a colour chosen for something this look does not have", () => {
    const dyed = dye(dye(dye(PLAIN, "hat", "#111111"), "hair", "#222222"), "shirt", "#333333");
    expect(trimmed(dyed, LOOK).colours).toEqual([{ id: "hair", hex: "#222222" }]);
  });

  it("does not touch the recipe on screen, so the colour is still there to go back to", () => {
    const dyed = dye(PLAIN, "hat", "#111111");
    trimmed(dyed, LOOK);
    expect(dyed.colours).toEqual([{ id: "hat", hex: "#111111" }]);
  });
});
