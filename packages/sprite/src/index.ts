/**
 * Skin data format — shared by the editor, the API and both SPAs.
 *
 * The single most important property of this format: **a skin is numbers, not
 * markup.** A skin cannot contain a `<script>`, a `<foreignObject>` or an event
 * handler, because there is nowhere to put one. The API therefore never has to
 * sanitize anything; it only has to validate that the numbers are in range and
 * that the two string fields match a strict pattern.
 *
 * See docs/02-sprite-format.md for the reasoning and the full validation rules.
 */

/** Every fallible function in this package returns this instead of throwing. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Skin specification
// ---------------------------------------------------------------------------

/**
 * Part slots, back to front. Every skin must supply exactly these slots so that
 * one player's hair composes correctly with another player's shirt.
 *
 * This is a contract, not a preference: parts are drawn on a shared canvas, so
 * a skin with a different slot set or canvas size would not line up.
 */
export const PART_SLOTS = ["body", "shirt", "pants", "shoes", "hair"] as const;
export type PartSlot = (typeof PART_SLOTS)[number];

/** Hard limits. The API rejects anything outside them; the editor prevents them. */
export const SKIN_SPEC = {
  /** Square canvas, one size only. Fixed so parts always share a coordinate space. */
  canvasSize: 16,
  maxFramesPerPart: 8,
  maxPaletteEntries: 32,
  /** Upper bound on the serialized payload the API will accept. */
  maxBytes: 64 * 1024,
  /** Palette ids become CSS custom property names (`--c-<id>`), so they are strict. */
  paletteIdPattern: /^[a-z0-9-]{1,32}$/,
  /** Palette colours land in a `fill` attribute, so only plain hex is allowed. */
  hexPattern: /^#[0-9a-fA-F]{6}$/,
} as const;

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

export interface PaletteEntry {
  /** Matches SKIN_SPEC.paletteIdPattern. Becomes `var(--c-<id>)` on export. */
  id: string;
  /** Matches SKIN_SPEC.hexPattern. */
  hex: string;
}

/**
 * One animation frame. `cells` is a run-length encoded sequence of
 * `[paletteIndex, runLength]` pairs covering exactly canvasSize² cells, where
 * paletteIndex 0 means transparent and n means `palette[n - 1]`.
 *
 * Run-length rather than a flat array: pixel art is mostly flat colour, and a
 * per-cell array of numbers is roughly 60× larger once it is JSON.
 */
export interface Frame {
  durationMs: number;
  cells: ReadonlyArray<readonly [paletteIndex: number, runLength: number]>;
}

export interface Part {
  slot: PartSlot;
  frames: Frame[];
}

/** The editable source of truth. This is what gets stored and transferred. */
export interface Skin {
  formatVersion: 1;
  name: string;
  palette: PaletteEntry[];
  parts: Part[];
}

/**
 * Render-ready form, derived from a Skin at write time so the read path stays
 * cheap. `[x, y, w, h, paletteIndex]` — the result of merging adjacent cells of
 * the same colour into rectangles.
 */
export type Rect = readonly [x: number, y: number, w: number, h: number, paletteIndex: number];

export interface RenderableFrame {
  durationMs: number;
  rects: Rect[];
}

export interface RenderableSkin {
  formatVersion: 1;
  palette: PaletteEntry[];
  parts: { slot: PartSlot; frames: RenderableFrame[] }[];
}

// ---------------------------------------------------------------------------
// To implement (see docs/02-sprite-format.md and docs/05-roadmap.md)
// ---------------------------------------------------------------------------

export type SkinError =
  | { kind: "not_implemented" }
  | { kind: "too_large"; bytes: number }
  | { kind: "bad_canvas_size"; got: number }
  | { kind: "bad_cell_count"; slot: string; frame: number; got: number }
  | { kind: "bad_palette_id"; id: string }
  | { kind: "bad_hex"; hex: string }
  | { kind: "missing_slot"; slot: PartSlot }
  | { kind: "too_many"; what: string; got: number; max: number };

/**
 * Validates untrusted input and returns a Skin. This is the only place user
 * input becomes a Skin, so it is also the security boundary — nothing
 * downstream re-checks.
 */
export function parseSkin(_input: unknown): Result<Skin, SkinError> {
  return err({ kind: "not_implemented" });
}

/** Expands the run-length cells and merges same-coloured neighbours into rects. */
export function toRenderable(_skin: Skin): RenderableSkin {
  throw new Error("not implemented — see docs/05-roadmap.md");
}
