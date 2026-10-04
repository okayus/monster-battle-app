/**
 * Skins: how one becomes a row, and how the rows are read.
 *
 * Both ways a skin gets stored come through `skinRow` — a player saving from
 * the editor, and the skins that ship with the game — so both store the same
 * two things: the Skin as `parseSkin` rebuilt it, and the render-ready form
 * derived from it. It takes the value `parseSkin` returned and nothing else:
 * the parameter is a `Parsed<Skin>`, which only `parseSkin` can make.
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { ok } from "@mba/core";
import type { Result, SkinSummary } from "@mba/core";
import { skins } from "@mba/db";
import type { NewSkinRow, Read } from "@mba/db";
import { parseSkin, toRenderable } from "@mba/sprite";
import type { Parsed, RenderableSkin, Skin, SkinError } from "@mba/sprite";

import type { UserId } from "./auth.js";
import type { Decision, World } from "./runtime.js";

/**
 * Stores what the editor drew, as a new skin.
 *
 * `body` is whatever the request carried. `parseSkin` is the single trust
 * boundary for skins (docs/02-sprite-format.md): what goes on from here is
 * the value it rebuilt, so nothing the validator did not look at can reach
 * storage. The owner is whoever is asking; the body has no say in it.
 */
export function drawSkin(
  { newId }: Pick<World, "newId">,
  userId: UserId,
  body: unknown,
): Result<Decision<{ id: string }>, SkinError> {
  const parsed = parseSkin(body);
  if (!parsed.ok) return parsed;

  const id = newId();
  return ok({
    answer: { id },
    changes: [{ kind: "skin_drawn", id, ownerId: userId, skin: parsed.value }],
  });
}

export function skinRow(
  id: string,
  ownerId: UserId | null,
  skin: Parsed<Skin>,
  now: Date,
): NewSkinRow {
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
export function listSkins(read: Read): SkinSummary[] {
  return read
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

export function findSkinSummary(read: Read, id: string): SkinSummary | undefined {
  const row = read
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
export function wearableSkinIds(read: Read, ids: readonly string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const rows = read
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
export function renderablesOf(read: Read, ids: readonly string[]): Map<string, RenderableSkin> {
  const found = new Map<string, RenderableSkin>();
  if (ids.length === 0) return found;
  const rows = read
    .select({ id: skins.id, renderable: skins.renderable })
    .from(skins)
    .where(and(inArray(skins.id, [...ids]), isNull(skins.retiredAt)))
    .all();
  // A cast, not a check: this text was produced by `toRenderable` when the
  // skin was stored.
  for (const row of rows) found.set(row.id, JSON.parse(row.renderable) as RenderableSkin);
  return found;
}

/**
 * A skin's render-ready form, as the text that was stored. Retired or not: a
 * monster of a retired species still has to be drawn.
 *
 * The text goes out as it is: no parse, no re-serialize. This is the payoff
 * of deriving the render-ready form at write time — the read path is one
 * indexed lookup and a copy.
 */
export function storedDrawing(read: Read, id: string): string | undefined {
  return read.select({ text: skins.renderable }).from(skins).where(eq(skins.id, id)).get()?.text;
}

/**
 * The other half of what was stored: the skin as `parseSkin` rebuilt it,
 * which is what an editor needs to carry on from. Screens that only draw
 * never ask for this: they would have to expand and merge it themselves,
 * which is the work that was done once, at write time, so that no read has to
 * repeat it.
 */
export function storedSource(read: Read, id: string): string | undefined {
  return read.select({ text: skins.source }).from(skins).where(eq(skins.id, id)).get()?.text;
}
