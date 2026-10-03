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
 * is decided once — the same arrangement as `saves.ts`.
 */

import { eq } from "drizzle-orm";

import { appearances } from "@mba/db";
import type { Db } from "@mba/db";
import type { Appearance, PaletteEntry } from "@mba/sprite";

/** The skin a player wears until they choose one. It ships with the game (seed.ts). */
export const DEFAULT_SKIN_ID = "player-default";

/**
 * The player's recipe, or the default look if they have never chosen one.
 * Asking does not write anything.
 */
export function loadAppearance(db: Db, userId: string): Appearance {
  const row = db.select().from(appearances).where(eq(appearances.userId, userId)).get();
  if (row === undefined) return { skinId: DEFAULT_SKIN_ID, parts: {}, colours: [] };

  // Casts, not checks: both columns were written by `saveAppearance`, from a
  // value that had already been through `parseAppearance`.
  return {
    skinId: row.skinId,
    parts: JSON.parse(row.partOverrides) as Appearance["parts"],
    colours: JSON.parse(row.colourOverrides) as PaletteEntry[],
  };
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
