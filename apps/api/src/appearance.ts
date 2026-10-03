/**
 * What a player looks like, as far as the server is concerned.
 *
 * The server keeps the recipe and nothing else (docs/03-data-model.md): which
 * skin is worn, which parts come from other skins, which colours are changed.
 * Putting the picture together is the browser's job, done with
 * `composeAppearance` from `@mba/sprite`. No composed drawing is stored here,
 * or anywhere.
 *
 * Anything that needs a player's look asks here, so "has not chosen one yet"
 * and "chose something that has since been retired" are decided once — the
 * same arrangement as `saves.ts`.
 */

import { eq } from "drizzle-orm";

import { appearances } from "@mba/db";
import type { Db } from "@mba/db";
import { PART_SLOTS, coloursOf, composeAppearance, skinsNamedBy } from "@mba/sprite";
import type { Appearance, PaletteEntry } from "@mba/sprite";

import { renderablesOf, wearableSkinIds } from "./skins.js";

/** The skin a player wears until they choose one. It ships with the game (seed.ts). */
export const DEFAULT_SKIN_ID = "player-default";

function defaultLook(): Appearance {
  return { skinId: DEFAULT_SKIN_ID, parts: {}, colours: [] };
}

/**
 * The player's recipe as it can be worn right now, or the default look if
 * they have never chosen one. Asking does not write anything.
 *
 * A recipe can outlive what it names: a skin in it may have been retired
 * since. That is settled here, so no screen has to handle "a look I cannot
 * draw" — and what comes back is always a recipe the server would accept if
 * it were sent straight back.
 *
 * The stored row is left alone. If the skin is brought back, so is the look.
 */
export function loadAppearance(db: Db, userId: string): Appearance {
  const row = db.select().from(appearances).where(eq(appearances.userId, userId)).get();
  if (row === undefined) return defaultLook();

  // Casts, not checks: both columns were written by `saveAppearance`, from a
  // value that had already been through `parseAppearance`.
  const stored: Appearance = {
    skinId: row.skinId,
    parts: JSON.parse(row.partOverrides) as Appearance["parts"],
    colours: JSON.parse(row.colourOverrides) as PaletteEntry[],
  };

  // The usual case, and the cheap one: everything it names can still be worn.
  // Nothing is parsed or put together to find that out.
  const named = skinsNamedBy(stored);
  const wearable = wearableSkinIds(db, named);
  if (named.every((id) => wearable.has(id))) return stored;

  // The skin that is worn is gone: there is nothing left to hang the rest on.
  if (!wearable.has(stored.skinId)) return defaultLook();

  // Only parts are gone. Those slots go back to the worn skin's own, and a
  // colour is kept only if the look that remains is still painted with it.
  const parts: Appearance["parts"] = {};
  for (const slot of PART_SLOTS) {
    const from = stored.parts[slot];
    if (from !== undefined && wearable.has(from)) parts[slot] = from;
  }
  const remaining = { skinId: stored.skinId, parts };
  const look = composeAppearance(remaining, renderablesOf(db, skinsNamedBy(remaining)));
  const painted = new Set((look === undefined ? [] : coloursOf(look)).map((entry) => entry.id));
  return { ...remaining, colours: stored.colours.filter((entry) => painted.has(entry.id)) };
}

/** Replaces the player's recipe. One row per user, so saving again never adds a second. */
export function saveAppearance(db: Db, userId: string, appearance: Appearance, now: Date): void {
  const values = {
    skinId: appearance.skinId,
    partOverrides: JSON.stringify(appearance.parts),
    colourOverrides: JSON.stringify(appearance.colours),
    updatedAt: now,
  };
  db.insert(appearances)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: appearances.userId, set: values })
    .run();
}
