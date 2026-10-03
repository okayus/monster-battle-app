/**
 * What the minimal editor sends to the API: the painted grid, wrapped into a
 * complete Skin.
 *
 * Pure, and kept apart from the component so it can be tested against the real
 * validator. The editor and `parseSkin` have to agree on the format, and the
 * cheapest place to find out that they do not is a unit test, not a 400 in the
 * browser.
 */

import { CELLS_PER_FRAME, PART_SLOTS, packFrame } from "@mba/sprite";
import type { CellGrid, PaletteEntry, PartSlot, Skin } from "@mba/sprite";

/** Fixed for now. Choosing and mixing colours is Step 6 (docs/05-roadmap.md). */
export const EDITOR_PALETTE: readonly PaletteEntry[] = [
  { id: "skin", hex: "#e8b98a" },
  { id: "hair", hex: "#5a3921" },
  { id: "shirt", hex: "#3f7bd6" },
  { id: "pants", hex: "#2f3a56" },
];

/** The one part this editor paints. Switching between parts is Step 6. */
export const EDITED_SLOT: PartSlot = "body";

/** There is a single frame, so its duration never shows. Any valid value will do. */
const FRAME_MS = 120;

/** A canvas with nothing painted on it. */
export function blankGrid(): number[] {
  return new Array<number>(CELLS_PER_FRAME).fill(0);
}

export function toSkinInput(name: string, grid: CellGrid): Skin {
  // The format requires every slot (docs/02-sprite-format.md §スキン規格), so
  // the slots this editor cannot paint yet are sent fully transparent.
  const blank = packFrame(blankGrid(), FRAME_MS);
  return {
    formatVersion: 1,
    name,
    palette: EDITOR_PALETTE.map((entry) => ({ id: entry.id, hex: entry.hex })),
    parts: PART_SLOTS.map((slot) => ({
      slot,
      frames: [slot === EDITED_SLOT ? packFrame(grid, FRAME_MS) : blank],
    })),
  };
}
