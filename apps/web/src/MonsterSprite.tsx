/**
 * A monster's picture, fetched like any other skin and drawn by `<Sprite>`.
 *
 * If it cannot be fetched the box stays empty and whatever is showing it
 * carries on: a missing picture is not worth stopping a fight for, or a list.
 */

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { RenderableSkin } from "@mba/sprite";
import { Sprite } from "@mba/sprite-react";

import { fetchSkin } from "./api.js";

// The <svg> has a viewBox and no size of its own, so it fills this box.
function box(size: string): CSSProperties {
  return { width: size, height: size, border: "1px solid #888", lineHeight: 0, flex: "none" };
}

export function MonsterSprite({ skinId, size = "8rem" }: { skinId: string; size?: string }) {
  const [skin, setSkin] = useState<RenderableSkin | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSkin(skinId).then((result) => {
      if (!cancelled && result.ok) setSkin(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, [skinId]);

  return <div style={box(size)}>{skin !== null && <Sprite skin={skin} />}</div>;
}
