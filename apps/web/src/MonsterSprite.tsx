/**
 * A monster's picture, drawn by `<Sprite>` once it is here.
 *
 * It is handed the request, not the id of the skin. Whoever loaded the monster
 * started fetching its picture in the same breath — the battle screen and the
 * monsters screen each do, in the function that loads them — and this only
 * waits for it (loaded.tsx).
 *
 * If the picture cannot be fetched the box stays empty and whatever is showing
 * it carries on: a missing picture is not worth stopping a fight for, or a
 * list.
 */

import type { CSSProperties } from "react";

import type { Result } from "@mba/core";
import type { RenderableSkin } from "@mba/sprite";
import { Sprite } from "@mba/sprite-react";

import type { ApiError } from "./api.js";
import { useSettled } from "./loaded.js";

/** A skin's drawing, on its way or already here: what `fetchSkin` returns. */
export type Picture = Promise<Result<RenderableSkin, ApiError>>;

// The <svg> has a viewBox and no size of its own, so it fills this box.
function box(size: string): CSSProperties {
  return { width: size, height: size, border: "1px solid #888", lineHeight: 0, flex: "none" };
}

export function MonsterSprite({ picture, size = "8rem" }: { picture: Picture; size?: string }) {
  const skin = useSettled(picture);
  return <div style={box(size)}>{skin?.ok && <Sprite skin={skin.value} />}</div>;
}
