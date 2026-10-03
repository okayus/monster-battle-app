/**
 * The palette, as three separate things to do.
 *
 * Picking a colour and adding one change nothing that is already drawn.
 * Remaking a colour changes every cell that uses it, in every part and every
 * frame. On screen they sit in different boxes, and remaking takes a
 * deliberate press of a button after it has said what it is about to touch.
 */

import { useState } from "react";
import type { CSSProperties } from "react";

import { SKIN_SPEC } from "@mba/sprite";
import type { PartSlot } from "@mba/sprite";

import { addColour, recolour, selectBrush, suggestColourId, usageOf } from "./model.js";
import type { EditorState, PaletteError } from "./model.js";
import { PART_NAMES } from "./names.js";

type Apply = (operation: (state: EditorState) => EditorState) => void;

const row: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  flexWrap: "wrap",
  alignItems: "center",
};

function swatch(colour: string, selected: boolean): CSSProperties {
  return {
    width: "2rem",
    height: "2rem",
    padding: 0,
    background: colour,
    border: selected ? "3px solid #111" : "1px solid #888",
    cursor: "pointer",
  };
}

function describeError(error: PaletteError): string {
  if (error.kind === "bad_palette_id") return "名前は、半角の小文字・数字・ハイフンで 32 文字まで";
  if (error.kind === "duplicate_palette_id") return `「${error.id}」はもうある`;
  if (error.kind === "bad_hex") return "色の形式が違う";
  return `色は ${error.max} 個まで`;
}

export function PalettePanel({ state, apply }: { state: EditorState; apply: Apply }) {
  const selected = state.palette[state.brush - 1];

  return (
    <>
      <fieldset>
        <legend>色を選ぶ</legend>
        <div style={row} role="group" aria-label="色">
          <button
            type="button"
            aria-label="消す"
            aria-pressed={state.brush === 0}
            title="消す"
            style={swatch("#ffffff", state.brush === 0)}
            onClick={() => apply((s) => selectBrush(s, 0))}
          />
          {state.palette.map((entry, i) => (
            <button
              key={entry.id}
              type="button"
              aria-label={entry.id}
              aria-pressed={state.brush === i + 1}
              title={entry.id}
              style={swatch(entry.hex, state.brush === i + 1)}
              onClick={() => apply((s) => selectBrush(s, i + 1))}
            />
          ))}
        </div>
      </fieldset>

      <AddColour state={state} apply={apply} />

      {/* Keyed by the colour, so choosing another one starts from that colour. */}
      {selected !== undefined && (
        <RemakeColour key={selected.id} state={state} apply={apply} paletteIndex={state.brush} />
      )}
    </>
  );
}

function AddColour({ state, apply }: { state: EditorState; apply: Apply }) {
  const [id, setId] = useState(() => suggestColourId(state));
  const [hex, setHex] = useState("#c0392b");
  const [error, setError] = useState<PaletteError | null>(null);
  const full = state.palette.length >= SKIN_SPEC.maxPaletteEntries;

  const add = () => {
    const result = addColour(state, id.trim(), hex);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setId(suggestColourId(result.value));
    apply(() => result.value);
  };

  return (
    <fieldset>
      <legend>色を足す</legend>
      <div style={row}>
        <input
          aria-label="足す色の名前"
          value={id}
          maxLength={32}
          style={{ width: "8rem" }}
          onChange={(event) => setId(event.target.value)}
        />
        <input
          type="color"
          aria-label="足す色"
          value={hex}
          onChange={(event) => setHex(event.target.value)}
        />
        <button type="button" disabled={full} onClick={add}>
          足す
        </button>
      </div>
      <p style={{ margin: "0.25rem 0 0" }}>すでに描いたものは変わらない。</p>
      {error !== null && <p role="alert">{describeError(error)}</p>}
    </fieldset>
  );
}

function partList(parts: PartSlot[]): string {
  return parts.map((slot) => PART_NAMES[slot]).join("・");
}

function RemakeColour({
  state,
  apply,
  paletteIndex,
}: {
  state: EditorState;
  apply: Apply;
  paletteIndex: number;
}) {
  const entry = state.palette[paletteIndex - 1];
  const [draft, setDraft] = useState(entry?.hex ?? "#000000");
  if (entry === undefined) return null;

  const usage = usageOf(state, paletteIndex);
  const changed = draft !== entry.hex;

  return (
    <fieldset>
      <legend>色を作り直す</legend>
      <p style={{ margin: 0 }} data-usage>
        「{entry.id}」は
        {usage.cells === 0
          ? "まだどこにも使われていない。"
          : `${partList(usage.parts)}の ${usage.cells} マスで使われている。作り直すと、その全部が変わる。`}
      </p>
      <div style={row}>
        <input
          type="color"
          aria-label="作り直す色"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="button"
          disabled={!changed}
          onClick={() => apply((s) => recolour(s, paletteIndex, draft))}
        >
          「{entry.id}」をこの色に作り直す
        </button>
      </div>
    </fieldset>
  );
}
