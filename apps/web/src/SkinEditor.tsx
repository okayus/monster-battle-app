/**
 * The smallest editor that proves the vertical slice (docs/05-roadmap.md,
 * Step 2): one part, one frame, a fixed handful of colours, and a save button.
 * It becomes a real drawing tool in Step 6.
 *
 * Nothing in here is a defence. The length cap on the name and the disabled
 * save button exist so the user is not handed a 400 they could have avoided.
 * The server checks everything again in `parseSkin`, and that check is the
 * only one that counts.
 */

import { useState } from "react";
import type { CSSProperties, PointerEvent } from "react";

import { SKIN_SPEC } from "@mba/sprite";

import { createSkin } from "./api.js";
import type { ApiError } from "./api.js";
import { EDITOR_PALETTE, blankGrid, toSkinInput } from "./skin-input.js";

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "failed"; error: ApiError };

/** How a transparent cell looks on the canvas. Only a display choice. */
const TRANSPARENT = "#ffffff";

/** The colour to show for a palette index: 0 is transparent, n is palette[n - 1]. */
function colourOf(paletteIndex: number): string {
  if (paletteIndex === 0) return TRANSPARENT;
  return EDITOR_PALETTE[paletteIndex - 1]?.hex ?? "magenta";
}

const canvas: CSSProperties = {
  display: "grid",
  gridTemplateColumns: `repeat(${SKIN_SPEC.canvasSize}, 1fr)`,
  width: "20rem",
  border: "1px solid #888",
  // Without this a touch drag scrolls the page instead of painting.
  touchAction: "none",
};

const cellBase: CSSProperties = {
  aspectRatio: "1",
  padding: 0,
  border: "1px solid #e4e4e4",
  borderRadius: 0,
  cursor: "crosshair",
};

const row: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  alignItems: "center",
  margin: "0.75rem 0",
};

function swatch(paletteIndex: number, selected: boolean): CSSProperties {
  return {
    width: "2rem",
    height: "2rem",
    padding: 0,
    background: colourOf(paletteIndex),
    border: selected ? "3px solid #111" : "1px solid #888",
    cursor: "pointer",
  };
}

export function SkinEditor({ onSaved }: { onSaved: (id: string) => void }) {
  const [grid, setGrid] = useState<number[]>(blankGrid);
  /** The palette index being painted with. 0 erases. */
  const [brush, setBrush] = useState(1);
  const [name, setName] = useState("");
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const paint = (cell: number) => {
    setGrid((current) =>
      current[cell] === brush ? current : current.map((value, i) => (i === cell ? brush : value)),
    );
  };

  const startStroke = (cell: number) => (event: PointerEvent<HTMLButtonElement>) => {
    // A touch pointer is captured by the element it lands on. Released, it
    // fires pointerenter on the cells it is dragged across, as a mouse does.
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    paint(cell);
  };

  const continueStroke = (cell: number) => (event: PointerEvent<HTMLButtonElement>) => {
    // `buttons` is 1 only while the primary button (or a finger) is down.
    if (event.buttons === 1) paint(cell);
  };

  const trimmedName = name.trim();
  const canSave = trimmedName !== "" && save.kind !== "saving";

  const onSave = async () => {
    setSave({ kind: "saving" });
    const result = await createSkin(toSkinInput(trimmedName, grid));
    if (!result.ok) {
      setSave({ kind: "failed", error: result.error });
      return;
    }
    setSave({ kind: "idle" });
    onSaved(result.value.id);
  };

  return (
    <section aria-label="スキンエディタ">
      <h2>スキンエディタ（最小）</h2>

      <div style={row} role="group" aria-label="色">
        <button
          type="button"
          aria-label="消す"
          aria-pressed={brush === 0}
          title="消す"
          style={swatch(0, brush === 0)}
          onClick={() => setBrush(0)}
        />
        {EDITOR_PALETTE.map((entry, i) => (
          <button
            key={entry.id}
            type="button"
            aria-label={entry.id}
            aria-pressed={brush === i + 1}
            title={entry.id}
            style={swatch(i + 1, brush === i + 1)}
            onClick={() => setBrush(i + 1)}
          />
        ))}
      </div>

      <div style={canvas} role="group" aria-label="キャンバス">
        {/* The grid never reorders, so the cell's position is a stable key. */}
        {grid.map((paletteIndex, cell) => (
          <button
            key={cell}
            type="button"
            aria-label={`${cell % SKIN_SPEC.canvasSize},${Math.floor(cell / SKIN_SPEC.canvasSize)}`}
            style={{ ...cellBase, background: colourOf(paletteIndex) }}
            onPointerDown={startStroke(cell)}
            onPointerEnter={continueStroke(cell)}
            // Keyboard activation arrives as a click, not as a pointer event.
            onClick={() => paint(cell)}
          />
        ))}
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
          value={name}
          maxLength={SKIN_SPEC.maxNameLength}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" disabled={!canSave}>
          {save.kind === "saving" ? "保存中…" : "保存"}
        </button>
        <button type="button" onClick={() => setGrid(blankGrid())}>
          全部消す
        </button>
      </form>

      {save.kind === "failed" && <p role="alert">保存できなかった（{save.error.kind}）</p>}
    </section>
  );
}
