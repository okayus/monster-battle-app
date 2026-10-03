/**
 * How a skin becomes a row.
 *
 * Both ways a skin gets stored come through here — a player saving from the
 * editor, and the skins that ship with the game — so both store the same two
 * things: the Skin as `parseSkin` rebuilt it, and the render-ready form
 * derived from it. Callers pass the value `parseSkin` returned, never the
 * input they gave it.
 */

import { asc, eq, inArray } from "drizzle-orm";

import type { SkinSummary } from "@mba/core";
import { skins } from "@mba/db";
import type { Db, NewSkinRow } from "@mba/db";
import { toRenderable } from "@mba/sprite";
import type { RenderableSkin, Skin } from "@mba/sprite";

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

/**
 * Every skin there is, by name and owner only. The drawings themselves stay
 * out of a list: whoever wants to see one asks for it by id.
 */
export function listSkins(db: Db): SkinSummary[] {
  return db
    .select({ id: skins.id, name: skins.name, ownerId: skins.ownerId })
    .from(skins)
    .orderBy(asc(skins.createdAt), asc(skins.id))
    .all();
}

export function skinExists(db: Db, id: string): boolean {
  return db.select({ id: skins.id }).from(skins).where(eq(skins.id, id)).get() !== undefined;
}

/**
 * The render-ready form of each of these skins, by id. An id that is missing
 * from the answer is a skin that does not exist.
 *
 * The stored text is parsed here, which the read path for a single skin never
 * does (it streams the text out as it is). This is for the write path, where a
 * recipe has to be checked against the skins it names.
 */
export function renderablesOf(db: Db, ids: readonly string[]): Map<string, RenderableSkin> {
  const found = new Map<string, RenderableSkin>();
  if (ids.length === 0) return found;
  const rows = db
    .select({ id: skins.id, renderable: skins.renderable })
    .from(skins)
    .where(inArray(skins.id, [...ids]))
    .all();
  // A cast, not a check: this text was produced by `toRenderable` when the
  // skin was stored.
  for (const row of rows) found.set(row.id, JSON.parse(row.renderable) as RenderableSkin);
  return found;
}
