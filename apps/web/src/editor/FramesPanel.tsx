/**
 * The frames of the animation: pick one to paint, add one, remove one, set how
 * long each shows, and play the whole thing.
 */

import { useState } from "react";
import type { CSSProperties } from "react";

import { SKIN_SPEC } from "@mba/sprite";
import type { RenderableSkin } from "@mba/sprite";
import { Sprite } from "@mba/sprite-react";

import {
  addFrame,
  canAddFrame,
  currentDuration,
  removeFrame,
  selectFrame,
  setDuration,
} from "./model.js";
import type { EditorState } from "./model.js";

type Apply = (operation: (state: EditorState) => EditorState) => void;

const row: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  flexWrap: "wrap",
  alignItems: "center",
};

function thumb(selected: boolean): CSSProperties {
  return {
    width: "3rem",
    height: "3rem",
    padding: 0,
    background: "#ffffff",
    border: selected ? "3px solid #111" : "1px solid #888",
    cursor: "pointer",
    lineHeight: 0,
  };
}

/**
 * How long the selected frame shows.
 *
 * The field holds text of its own, because on the way from "120" to "300" it
 * passes through things that are not durations at all (an empty field, "3").
 * Only a value the format accepts is handed on. The text is replaced when the
 * duration changes underneath it — a frame was removed, a skin was opened —
 * which is the "adjust state while rendering" pattern, not an effect.
 */
function DurationField({
  durationMs,
  onCommit,
}: {
  durationMs: number;
  onCommit: (durationMs: number) => void;
}) {
  const [text, setText] = useState(String(durationMs));
  const [shown, setShown] = useState(durationMs);
  if (shown !== durationMs) {
    setShown(durationMs);
    setText(String(durationMs));
  }

  return (
    <label>
      長さ{" "}
      <input
        type="number"
        aria-label="このコマの長さ（ミリ秒）"
        min={1}
        max={SKIN_SPEC.maxFrameDurationMs}
        style={{ width: "5rem" }}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onCommit(event.target.valueAsNumber);
        }}
      />{" "}
      ミリ秒
    </label>
  );
}

export function FramesPanel({
  state,
  apply,
  drawn,
  playing,
  onTogglePlaying,
}: {
  state: EditorState;
  apply: Apply;
  /** The whole drawing, for the thumbnails. */
  drawn: RenderableSkin;
  playing: boolean;
  onTogglePlaying: () => void;
}) {
  return (
    <fieldset>
      <legend>
        コマ（{state.frames.length} / {SKIN_SPEC.maxFramesPerPart}）
      </legend>

      <div style={row} role="group" aria-label="コマ">
        {/* Frames are told apart by position; there is nothing else to key them by. */}
        {state.frames.map((_, index) => (
          <button
            key={index}
            type="button"
            aria-label={`コマ ${index + 1}`}
            aria-pressed={state.frame === index}
            style={thumb(state.frame === index)}
            onClick={() => apply((s) => selectFrame(s, index))}
          >
            <Sprite skin={drawn} frame={index} />
          </button>
        ))}
      </div>

      <div style={{ ...row, marginTop: "0.5rem" }}>
        <button type="button" disabled={!canAddFrame(state)} onClick={() => apply(addFrame)}>
          コマを足す
        </button>
        <button
          type="button"
          disabled={state.frames.length <= 1}
          onClick={() => apply(removeFrame)}
        >
          このコマを消す
        </button>
        {/* Keyed by the frame, so text typed for one frame is not carried to the next. */}
        <DurationField
          key={state.frame}
          durationMs={currentDuration(state)}
          onCommit={(durationMs) => apply((s) => setDuration(s, durationMs))}
        />
        <button type="button" aria-pressed={playing} onClick={onTogglePlaying}>
          {playing ? "止める" : "再生"}
        </button>
      </div>
      <p style={{ margin: "0.25rem 0 0" }}>足したコマは、選んでいるコマの写しから始まる。</p>
    </fieldset>
  );
}
