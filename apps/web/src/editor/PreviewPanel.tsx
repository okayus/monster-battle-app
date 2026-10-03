/**
 * The whole character, as it will look — and two ways of trying it on that
 * change nothing in the drawing.
 *
 * Taking parts off just leaves them out of what is drawn. Trying a colour sets
 * a CSS variable on the box around the sprite: every colour in a skin is drawn
 * as `var(--c-<id>, <the colour it was drawn in>)`, so overriding the variable
 * recolours it from outside. That is how one skin will be worn in many
 * colours without being copied (docs/02-sprite-format.md), and this is the
 * first screen that uses it.
 */

import { useState } from "react";
import type { CSSProperties } from "react";

import { PART_SLOTS } from "@mba/sprite";
import type { PaletteEntry, PartSlot, RenderableSkin } from "@mba/sprite";
import { Sprite, useElapsedMs } from "@mba/sprite-react";

import { PART_NAMES } from "./names.js";

const box: CSSProperties = {
  width: "10rem",
  height: "10rem",
  border: "1px solid #888",
  background: "#ffffff",
  lineHeight: 0,
};

const row: CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  flexWrap: "wrap",
  alignItems: "center",
};

export function PreviewPanel({
  drawn,
  palette,
  frame,
  playing,
}: {
  drawn: RenderableSkin;
  palette: readonly PaletteEntry[];
  /** The frame to show while the animation is not playing. */
  frame: number;
  playing: boolean;
}) {
  const [hidden, setHidden] = useState<ReadonlySet<PartSlot>>(new Set());
  /** Colours being tried on, by palette id. Never written back to the drawing. */
  const [tried, setTried] = useState<Readonly<Record<string, string>>>({});
  // The clock lives here, so that only the preview re-renders while it runs.
  const elapsedMs = useElapsedMs(playing);

  const worn = { ...drawn, parts: drawn.parts.filter((part) => !hidden.has(part.slot)) };

  const variables: Record<string, string> = {};
  for (const [id, hex] of Object.entries(tried)) variables[`--c-${id}`] = hex;

  const toggle = (slot: PartSlot) => {
    const next = new Set(hidden);
    if (next.has(slot)) next.delete(slot);
    else next.add(slot);
    setHidden(next);
  };

  return (
    <fieldset>
      <legend>着せ替えプレビュー</legend>

      {/* Custom properties are valid CSS; React's types just do not list them. */}
      <div style={{ ...box, ...(variables as CSSProperties) }} data-preview>
        <Sprite skin={worn} frame={frame} elapsedMs={playing ? elapsedMs : undefined} />
      </div>

      <div style={{ ...row, marginTop: "0.5rem" }} role="group" aria-label="着るパーツ">
        {PART_SLOTS.map((slot) => (
          <label key={slot}>
            <input type="checkbox" checked={!hidden.has(slot)} onChange={() => toggle(slot)} />{" "}
            {PART_NAMES[slot]}
          </label>
        ))}
      </div>

      <div style={{ ...row, marginTop: "0.5rem" }} role="group" aria-label="色を試す">
        {palette.map((entry) => (
          <label key={entry.id}>
            {entry.id}{" "}
            <input
              type="color"
              aria-label={`${entry.id} を試す`}
              value={tried[entry.id] ?? entry.hex}
              onChange={(event) => setTried({ ...tried, [entry.id]: event.target.value })}
            />
          </label>
        ))}
        <button
          type="button"
          disabled={Object.keys(tried).length === 0}
          onClick={() => setTried({})}
        >
          試した色を戻す
        </button>
      </div>
      <p style={{ margin: "0.25rem 0 0" }}>
        ここで外したパーツも試した色も、絵には書き込まれない。保存されるのは描いたとおりのもの。
      </p>
    </fieldset>
  );
}
