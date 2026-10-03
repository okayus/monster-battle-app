/**
 * Getting a look from the server into something that can be drawn.
 *
 * The server hands out a recipe and, separately, each skin by id. Putting them
 * together happens here, in the browser, with the same `composeAppearance` the
 * server uses to check a recipe (docs/03-data-model.md): nothing composed is
 * ever stored or sent.
 */

import { err, ok } from "@mba/core";
import type { Result } from "@mba/core";
import { composeAppearance, skinsNamedBy } from "@mba/sprite";
import type { Appearance, RenderableSkin } from "@mba/sprite";

import { fetchAppearance, fetchSkin } from "../api.js";
import type { ApiError } from "../api.js";

/**
 * The render-ready form of each of these skins, fetched side by side. One that
 * cannot be fetched fails the lot: a look with a part missing is not the look.
 */
export async function fetchDrawings(
  ids: readonly string[],
): Promise<Result<Map<string, RenderableSkin>, ApiError>> {
  const unique = [...new Set(ids)];
  const fetched = await Promise.all(
    unique.map(async (id) => ({ id, result: await fetchSkin(id) })),
  );

  const drawings = new Map<string, RenderableSkin>();
  for (const { id, result } of fetched) {
    if (!result.ok) return result;
    drawings.set(id, result.value);
  }
  return ok(drawings);
}

/** A look that is ready to draw: the recipe, and the skins it names put together. */
export interface WornLook {
  appearance: Appearance;
  look: RenderableSkin;
}

/** What the player is wearing right now, as the server has it. */
export async function fetchWornLook(): Promise<Result<WornLook, ApiError>> {
  const appearance = await fetchAppearance();
  if (!appearance.ok) return appearance;

  const drawings = await fetchDrawings(skinsNamedBy(appearance.value));
  if (!drawings.ok) return drawings;

  const look = composeAppearance(appearance.value, drawings.value);
  // Every skin the recipe names was just fetched, so this cannot come back
  // empty. If it ever does, it is the same kind of failure as an answer that
  // was not the API's JSON.
  if (look === undefined) return err({ kind: "unexpected_response" });
  return ok({ appearance: appearance.value, look });
}
