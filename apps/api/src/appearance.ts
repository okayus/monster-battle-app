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

import { err, ok } from "@mba/core";
import type { Result } from "@mba/core";
import { appearances } from "@mba/db";
import type { Read } from "@mba/db";
import {
  PART_SLOTS,
  coloursOf,
  composeAppearance,
  parseAppearance,
  skinsNamedBy,
} from "@mba/sprite";
import type { Appearance, AppearanceError, PaletteEntry, Parsed } from "@mba/sprite";

import type { UserId } from "./auth.js";
import type { Resolved } from "./changes.js";
import type { Decision, World } from "./runtime.js";
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
export function loadAppearance(read: Read, userId: UserId): Appearance {
  const row = read.select().from(appearances).where(eq(appearances.userId, userId)).get();
  if (row === undefined) return defaultLook();

  // Casts, not checks: both columns were written by `commit`, from a value
  // that had already been through `parseAppearance` (see `chooseLook`).
  const stored: Appearance = {
    skinId: row.skinId,
    parts: JSON.parse(row.partOverrides) as Appearance["parts"],
    colours: JSON.parse(row.colourOverrides) as PaletteEntry[],
  };

  // The usual case, and the cheap one: everything it names can still be worn.
  // Nothing is parsed or put together to find that out.
  const named = skinsNamedBy(stored);
  const wearable = wearableSkinIds(read, named);
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
  const look = composeAppearance(remaining, renderablesOf(read, skinsNamedBy(remaining)));
  const painted = new Set((look === undefined ? [] : coloursOf(look)).map((entry) => entry.id));
  return { ...remaining, colours: stored.colours.filter((entry) => painted.has(entry.id)) };
}

export type LookError =
  | AppearanceError
  /** A skin the recipe names does not exist — or has been retired, which to a player is the same. */
  | { kind: "unknown_skin"; skinId: string }
  /** A colour the recipe changes is not one this look is painted with. */
  | { kind: "unknown_colour"; id: string };

/**
 * Replaces the player's recipe with the one in `body`.
 *
 * Three checks, each only if the one before passed. What a recipe may say at
 * all is `parseAppearance`'s to decide (docs/02-sprite-format.md), and from
 * there on only the value it rebuilt is used — never `body`. What only the
 * database can say comes after: whether the skins it names can be worn, and
 * whether the look they make has the colours the recipe changes.
 */
export function chooseLook(
  { read }: Pick<World, "read">,
  userId: UserId,
  body: unknown,
): Result<Decision<Appearance>, LookError> {
  const parsed = parseAppearance(body);
  if (!parsed.ok) return parsed;
  const appearance = parsed.value;

  // Can the skins it names be worn? One that has been retired is refused
  // exactly like one that never existed.
  const named = skinsNamedBy(appearance);
  const skins = renderablesOf(read, named);
  for (const skinId of named) {
    if (!skins.has(skinId)) return err({ kind: "unknown_skin", skinId });
  }

  // And does the look have the colours the recipe changes? The look is put
  // together by the same function the browser draws it with, so "a colour
  // this look has" means the same thing on both sides.
  const look = composeAppearance(appearance, skins);
  const painted = new Set((look === undefined ? [] : coloursOf(look)).map((entry) => entry.id));
  for (const { id } of appearance.colours) {
    if (!painted.has(id)) return err({ kind: "unknown_colour", id });
  }

  // Everything it names has been looked up. This is the line that says so.
  const resolved = appearance as Resolved<Parsed<Appearance>>;
  return ok({
    answer: appearance,
    changes: [{ kind: "look_chosen", userId, appearance: resolved }],
  });
}
