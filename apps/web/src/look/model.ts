/**
 * Choosing a look: every change to the recipe, as a pure function.
 *
 * The screen holds an `Appearance` and calls these; nothing here fetches or
 * draws. The same split as the editor's `model.ts`, for the same reason — what
 * a choice does to the recipe can be tested without a browser.
 *
 * None of this is a defence. The server checks every recipe it is sent
 * (`parseAppearance`, then that what it names exists); these functions only
 * keep the screen from sending something it could have known would be refused.
 */

import { PART_SLOTS, coloursOf } from "@mba/sprite";
import type { Appearance, PaletteEntry, PartSlot, RenderableSkin } from "@mba/sprite";

/**
 * Wears a different skin. Parts taken from other skins stay as they are, and
 * so do the colours: "hair, in red" is about hair, not about one skin.
 */
export function wear(appearance: Appearance, skinId: string): Appearance {
  const parts: Appearance["parts"] = {};
  for (const slot of PART_SLOTS) {
    const from = appearance.parts[slot];
    // A slot that was taken from the skin now being worn is no longer a swap.
    if (from !== undefined && from !== skinId) parts[slot] = from;
  }
  return { ...appearance, skinId, parts };
}

/** Takes one slot from another skin — or, with null, from the worn skin again. */
export function takePart(
  appearance: Appearance,
  slot: PartSlot,
  skinId: string | null,
): Appearance {
  const parts: Appearance["parts"] = {};
  for (const each of PART_SLOTS) {
    const from = each === slot ? (skinId ?? undefined) : appearance.parts[each];
    if (from !== undefined && from !== appearance.skinId) parts[each] = from;
  }
  return { ...appearance, parts };
}

/** The colour worn for an id, if one was chosen. */
export function colourWorn(colours: readonly PaletteEntry[], id: string): string | undefined {
  return colours.find((entry) => entry.id === id)?.hex;
}

/** The list with one colour set: replaced where the id is already there, added where not. */
export function withColour(
  colours: readonly PaletteEntry[],
  id: string,
  hex: string,
): PaletteEntry[] {
  if (colours.some((entry) => entry.id === id)) {
    return colours.map((entry) => (entry.id === id ? { id, hex } : entry));
  }
  return [...colours, { id, hex }];
}

/** Wears a colour in place of the drawn one, wherever that id is painted. */
export function dye(appearance: Appearance, id: string, hex: string): Appearance {
  return { ...appearance, colours: withColour(appearance.colours, id, hex) };
}

/** Back to the colours as they were drawn. */
export function undye(appearance: Appearance): Appearance {
  return { ...appearance, colours: [] };
}

/**
 * The recipe as it is sent: without the colours this look is not painted with.
 *
 * A colour chosen for one skin stays in the recipe on screen while other skins
 * are tried on, so that going back finds it still there. The server refuses a
 * colour the look does not have, so those are left out on the way out.
 */
export function trimmed(appearance: Appearance, look: RenderableSkin): Appearance {
  const painted = new Set(coloursOf(look).map((entry) => entry.id));
  return { ...appearance, colours: appearance.colours.filter((entry) => painted.has(entry.id)) };
}
