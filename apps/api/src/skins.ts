/**
 * How a skin becomes a row.
 *
 * Both ways a skin gets stored come through here — a player saving from the
 * editor, and the skins that ship with the game — so both store the same two
 * things: the Skin as `parseSkin` rebuilt it, and the render-ready form
 * derived from it. Callers pass the value `parseSkin` returned, never the
 * input they gave it.
 */

import type { NewSkinRow } from "@mba/db";
import { toRenderable } from "@mba/sprite";
import type { Skin } from "@mba/sprite";

export function skinRow(id: string, ownerId: string | null, skin: Skin, now: Date): NewSkinRow {
  return {
    id,
    ownerId,
    name: skin.name,
    formatVersion: skin.formatVersion,
    source: JSON.stringify(skin),
    // The expensive step (merging cells into rectangles) happens here, once,
    // so that reading a skin never has to do it.
    renderable: JSON.stringify(toRenderable(skin)),
    createdAt: now,
  };
}
