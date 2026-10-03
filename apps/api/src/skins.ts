/**
 * How a skin becomes a row.
 *
 * Both ways a skin gets stored come through here — a player saving from the
 * editor, and the skins that ship with the game — so both store the same two
 * things: the Skin as `parseSkin` rebuilt it, and the render-ready form
 * derived from it. Callers pass the value `parseSkin` returned, never the
 * input they gave it.
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

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
 * Every skin there is, retired or not, by name and owner only. The drawings
 * themselves stay out of a list: whoever wants to see one asks for it by id.
 *
 * Whoever hands this list on decides what "retired" means for their reader:
 * the admin API shows the mark, the game API leaves those skins out.
 */
export function listSkins(db: Db): SkinSummary[] {
  return db
    .select({
      id: skins.id,
      name: skins.name,
      ownerId: skins.ownerId,
      retiredAt: skins.retiredAt,
    })
    .from(skins)
    .orderBy(asc(skins.createdAt), asc(skins.id))
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      ownerId: row.ownerId,
      retired: row.retiredAt !== null,
    }));
}

export function findSkinSummary(db: Db, id: string): SkinSummary | undefined {
  const row = db
    .select({
      id: skins.id,
      name: skins.name,
      ownerId: skins.ownerId,
      retiredAt: skins.retiredAt,
    })
    .from(skins)
    .where(eq(skins.id, id))
    .get();
  if (row === undefined) return undefined;
  return { id: row.id, name: row.name, ownerId: row.ownerId, retired: row.retiredAt !== null };
}

/** Which of these skins can be worn: they exist, and they have not been retired. */
export function wearableSkinIds(db: Db, ids: readonly string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const rows = db
    .select({ id: skins.id })
    .from(skins)
    .where(and(inArray(skins.id, [...ids]), isNull(skins.retiredAt)))
    .all();
  return new Set(rows.map((row) => row.id));
}

/**
 * The render-ready form of each of these skins that can be worn, by id. An id
 * that is missing from the answer is a skin that does not exist — or one that
 * has been retired, which to whoever is dressing comes to the same thing.
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
    .where(and(inArray(skins.id, [...ids]), isNull(skins.retiredAt)))
    .all();
  // A cast, not a check: this text was produced by `toRenderable` when the
  // skin was stored.
  for (const row of rows) found.set(row.id, JSON.parse(row.renderable) as RenderableSkin);
  return found;
}
