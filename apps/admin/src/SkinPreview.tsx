/**
 * A skin, drawn with the same `<Sprite>` the player's screens use and from the
 * same endpoint. What an admin sees in a preview is therefore what a player
 * will see in a battle — not an approximation of it drawn some other way.
 */

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { RenderableSkin } from "@mba/sprite";
import { Sprite } from "@mba/sprite-react";

import { fetchSkin } from "./api.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; skin: RenderableSkin }
  | { kind: "failed" };

/**
 * The caller keys this component by `skinId`, so choosing a different skin is
 * a fresh mount that starts out empty instead of showing the previous one.
 */
export function SkinPreview({ skinId, size }: { skinId: string; size: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void fetchSkin(skinId).then((result) => {
      if (cancelled) return;
      setState(result.ok ? { kind: "loaded", skin: result.value } : { kind: "failed" });
    });
    return () => {
      cancelled = true;
    };
  }, [skinId]);

  // The <svg> has a viewBox and no size of its own, so it fills this box.
  const box: CSSProperties = {
    width: size,
    height: size,
    border: "1px solid #888",
    lineHeight: 0,
    display: "grid",
    placeItems: "center",
  };

  return (
    <div style={box} data-skin={skinId}>
      {state.kind === "loaded" && <Sprite skin={state.skin} />}
      {state.kind === "failed" && <span style={{ lineHeight: 1 }}>？</span>}
    </div>
  );
}
