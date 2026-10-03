import { describe, expect, it } from "vitest";

import { expandFrame, parseSkin } from "@mba/sprite";
import type { Skin } from "@mba/sprite";

import { EDITED_SLOT, EDITOR_PALETTE, blankGrid, toSkinInput } from "./skin-input.js";

/** A grid that uses transparent and every palette colour, in short runs. */
function busyGrid(): number[] {
  return blankGrid().map((_, i) => Math.floor(i / 3) % (EDITOR_PALETTE.length + 1));
}

/** The skin as the server would see it: after the trip through JSON. */
function received(skin: Skin): unknown {
  return JSON.parse(JSON.stringify(skin));
}

describe("toSkinInput", () => {
  it("produces a skin the server's validator accepts, even with nothing painted", () => {
    expect(parseSkin(received(toSkinInput("empty", blankGrid()))).ok).toBe(true);
  });

  it("produces a skin the validator accepts with every colour in use", () => {
    expect(parseSkin(received(toSkinInput("busy", busyGrid()))).ok).toBe(true);
  });

  it("is already in the form the server stores, so nothing is rewritten on the way in", () => {
    const sent = toSkinInput("busy", busyGrid());
    const result = parseSkin(received(sent));
    if (!result.ok) throw new Error(`rejected: ${JSON.stringify(result.error)}`);
    expect(result.value).toEqual(sent);
  });

  it("puts the painted grid in the edited slot and leaves every other slot transparent", () => {
    const grid = busyGrid();
    const skin = toSkinInput("busy", grid);
    for (const part of skin.parts) {
      const frame = part.frames[0];
      if (frame === undefined) throw new Error(`${part.slot} has no frame`);
      expect(expandFrame(frame)).toEqual(part.slot === EDITED_SLOT ? grid : blankGrid());
    }
  });
});
