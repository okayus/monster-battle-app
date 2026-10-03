/**
 * The skin editor: every part, every frame, a palette that can grow, and a
 * preview of the result.
 *
 * The state lives in the caller and everything done to it is a pure function
 * from `model.ts`; this component decides when to call them and what to draw.
 *
 * Nothing in here is a defence. The limits the editor keeps to — frame counts,
 * palette ids, name length — are there so the user is not handed a 400 they
 * could have avoided. The server checks everything again in `parseSkin`, and
 * that check is the only one that counts.
 */

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { PART_SLOTS, SKIN_SPEC } from "@mba/sprite";

import { createSkin } from "../api.js";
import type { ApiError } from "../api.js";
import { Canvas } from "./Canvas.js";
import { FramesPanel } from "./FramesPanel.js";
import {
  clearPart,
  currentGrid,
  draw,
  newEditor,
  paint,
  rename,
  selectSlot,
  toSkin,
} from "./model.js";
import type { EditorState } from "./model.js";
import { PART_NAMES } from "./names.js";
import { PalettePanel } from "./PalettePanel.js";
import { PreviewPanel } from "./PreviewPanel.js";

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "failed"; error: ApiError };

const columns: CSSProperties = {
  display: "flex",
  gap: "2rem",
  flexWrap: "wrap",
  alignItems: "flex-start",
};
const stack: CSSProperties = { display: "grid", gap: "0.75rem", justifyItems: "start" };
const row: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  flexWrap: "wrap",
  alignItems: "center",
};

function partButton(selected: boolean): CSSProperties {
  return {
    font: "inherit",
    padding: "0.25rem 0.75rem",
    cursor: "pointer",
    background: selected ? "#111" : "#f0f0f0",
    color: selected ? "#fff" : "#111",
    border: "1px solid #888",
  };
}

export function SkinEditor({
  state,
  onChange,
  onSaved,
}: {
  state: EditorState;
  /** Applies one operation from `model.ts` to the state. */
  onChange: (operation: (state: EditorState) => EditorState) => void;
  onSaved: (id: string) => void;
}) {
  const [showOthers, setShowOthers] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  /** Starting over throws the drawing away, so it takes two presses. */
  const [confirmingReset, setConfirmingReset] = useState(false);

  // Run on every change to the drawing. It is the same merge the server does
  // on save, on a 16×16 canvas, so there is nothing to wait for.
  const drawn = useMemo(() => draw(state), [state]);
  const others = showOthers
    ? { ...drawn, parts: drawn.parts.filter((part) => part.slot !== state.slot) }
    : null;

  const trimmedName = state.name.trim();
  const canSave = trimmedName !== "" && save.kind !== "saving";

  const onSave = async () => {
    setSave({ kind: "saving" });
    const result = await createSkin(toSkin(state));
    if (!result.ok) {
      setSave({ kind: "failed", error: result.error });
      return;
    }
    setSave({ kind: "idle" });
    onSaved(result.value.id);
  };

  return (
    <section aria-label="スキンエディタ">
      <h2>スキンエディタ</h2>

      <div style={columns}>
        <div style={stack}>
          <div style={row} role="group" aria-label="パーツ">
            {PART_SLOTS.map((slot) => (
              <button
                key={slot}
                type="button"
                aria-pressed={state.slot === slot}
                style={partButton(state.slot === slot)}
                onClick={() => onChange((s) => selectSlot(s, slot))}
              >
                {PART_NAMES[slot]}
              </button>
            ))}
          </div>

          <Canvas
            grid={currentGrid(state)}
            palette={state.palette}
            ghost={others}
            ghostFrame={state.frame}
            onPaint={(cell) => onChange((s) => paint(s, cell))}
          />

          <div style={row}>
            <label>
              <input
                type="checkbox"
                checked={showOthers}
                onChange={(event) => setShowOthers(event.target.checked)}
              />{" "}
              ほかのパーツを透かして見る
            </label>
            <button type="button" onClick={() => onChange(clearPart)}>
              このパーツを消す
            </button>
            {confirmingReset ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onChange(newEditor);
                    setConfirmingReset(false);
                  }}
                >
                  本当に全部消す
                </button>
                <button type="button" onClick={() => setConfirmingReset(false)}>
                  やめる
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmingReset(true)}>
                新しく描く
              </button>
            )}
          </div>

          <form
            style={row}
            onSubmit={(event) => {
              event.preventDefault();
              if (canSave) void onSave();
            }}
          >
            <input
              aria-label="スキンの名前"
              placeholder="スキンの名前"
              value={state.name}
              maxLength={SKIN_SPEC.maxNameLength}
              onChange={(event) => {
                const name = event.target.value;
                onChange((s) => rename(s, name));
              }}
            />
            <button type="submit" disabled={!canSave}>
              {save.kind === "saving" ? "保存中…" : "保存"}
            </button>
          </form>
          {save.kind === "failed" && <p role="alert">保存できなかった（{save.error.kind}）</p>}
        </div>

        <div style={stack}>
          <PalettePanel state={state} apply={onChange} />
          <FramesPanel
            state={state}
            apply={onChange}
            drawn={drawn}
            playing={playing}
            onTogglePlaying={() => setPlaying((now) => !now)}
          />
          <PreviewPanel
            drawn={drawn}
            palette={state.palette}
            frame={state.frame}
            playing={playing}
          />
        </div>
      </div>
    </section>
  );
}
