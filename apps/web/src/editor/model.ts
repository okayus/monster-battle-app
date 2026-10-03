/**
 * The skin editor's state, and everything that can be done to it.
 *
 * Pure: every operation takes a state and returns a state, and none of them
 * touches the DOM or the network. The components only decide *when* to call
 * these; what the result is gets decided here, where it can be tested against
 * the real validator (`parseSkin`).
 *
 * The editor's idea of a skin is simpler than the format's. The format lets
 * every part have its own number of frames; the editor has one row of frames
 * for the whole character, and every part has a grid in each. That is what a
 * person drawing expects ("frame 2 of the character"), and it is always a
 * valid thing to write out.
 *
 * As everywhere on this side of the API, the limits enforced here are a
 * courtesy. The server checks the result again, and that check is the one
 * that counts.
 */

import {
  CELLS_PER_FRAME,
  PART_SLOTS,
  SKIN_SPEC,
  err,
  expandFrame,
  ok,
  packFrame,
  toRenderable,
} from "@mba/sprite";
import type { PaletteEntry, PartSlot, RenderableSkin, Result, Skin, SkinError } from "@mba/sprite";

/** One palette index per cell, row-major. 0 is transparent. Never mutated. */
export type Grid = readonly number[];

/** One frame of the whole character: a grid for every part, and how long it shows. */
export interface EditorFrame {
  durationMs: number;
  grids: Readonly<Record<PartSlot, Grid>>;
}

export interface EditorState {
  name: string;
  palette: readonly PaletteEntry[];
  /** At least one, at most `SKIN_SPEC.maxFramesPerPart`. */
  frames: readonly EditorFrame[];
  /** The part being painted. */
  slot: PartSlot;
  /** The frame being painted: an index into `frames`. */
  frame: number;
  /** The palette index being painted with. 0 erases. */
  brush: number;
}

export const DEFAULT_FRAME_MS = 120;

const DEFAULT_PALETTE: readonly PaletteEntry[] = [
  { id: "skin", hex: "#e8b98a" },
  { id: "hair", hex: "#5a3921" },
  { id: "shirt", hex: "#3f7bd6" },
  { id: "pants", hex: "#2f3a56" },
];

function blankGrid(): Grid {
  return new Array<number>(CELLS_PER_FRAME).fill(0);
}

/**
 * A grid for every part. Written out slot by slot instead of built in a loop,
 * so that a slot added to the format is a compile error here until it is
 * handled.
 */
function gridsFrom(make: (slot: PartSlot) => Grid): Record<PartSlot, Grid> {
  return {
    body: make("body"),
    shirt: make("shirt"),
    pants: make("pants"),
    shoes: make("shoes"),
    hair: make("hair"),
  };
}

export function newEditor(): EditorState {
  return {
    name: "",
    palette: DEFAULT_PALETTE,
    frames: [{ durationMs: DEFAULT_FRAME_MS, grids: gridsFrom(blankGrid) }],
    slot: "body",
    frame: 0,
    brush: 1,
  };
}

// ---------------------------------------------------------------------------
// Looking at the state
// ---------------------------------------------------------------------------

/** The frame being painted. `frame` is always in range, so this is never missing. */
function currentFrame(state: EditorState): EditorFrame {
  return state.frames[state.frame] ?? { durationMs: DEFAULT_FRAME_MS, grids: gridsFrom(blankGrid) };
}

/** The grid under the brush: the selected part, in the selected frame. */
export function currentGrid(state: EditorState): Grid {
  return currentFrame(state).grids[state.slot];
}

export function currentDuration(state: EditorState): number {
  return currentFrame(state).durationMs;
}

export interface Usage {
  /** How many cells are painted with this colour, over every part and frame. */
  cells: number;
  /** The parts that use it, in draw order. */
  parts: PartSlot[];
}

/**
 * Where a colour is used. Shown before a colour is remade, because remaking
 * it changes every one of these cells at once.
 */
export function usageOf(state: EditorState, paletteIndex: number): Usage {
  let cells = 0;
  const parts: PartSlot[] = [];
  for (const slot of PART_SLOTS) {
    let inPart = 0;
    for (const frame of state.frames) {
      for (const cell of frame.grids[slot]) if (cell === paletteIndex) inPart++;
    }
    if (inPart > 0) parts.push(slot);
    cells += inPart;
  }
  return { cells, parts };
}

// ---------------------------------------------------------------------------
// Choosing what to work on
// ---------------------------------------------------------------------------

export function rename(state: EditorState, name: string): EditorState {
  return { ...state, name };
}

export function selectSlot(state: EditorState, slot: PartSlot): EditorState {
  return state.slot === slot ? state : { ...state, slot };
}

export function selectFrame(state: EditorState, frame: number): EditorState {
  if (!Number.isInteger(frame) || frame < 0 || frame >= state.frames.length) return state;
  return state.frame === frame ? state : { ...state, frame };
}

export function selectBrush(state: EditorState, brush: number): EditorState {
  if (!Number.isInteger(brush) || brush < 0 || brush > state.palette.length) return state;
  return state.brush === brush ? state : { ...state, brush };
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

/** Replaces the grid under the brush, leaving every other part and frame as it was. */
function withCurrentGrid(state: EditorState, grid: Grid): EditorState {
  const frames = state.frames.map((frame, index) =>
    index === state.frame ? { ...frame, grids: { ...frame.grids, [state.slot]: grid } } : frame,
  );
  return { ...state, frames };
}

/**
 * Paints one cell with the brush. Hands back the very same state when the cell
 * already has that colour, so dragging over painted cells re-renders nothing.
 */
export function paint(state: EditorState, cell: number): EditorState {
  const grid = currentGrid(state);
  if (!Number.isInteger(cell) || cell < 0 || cell >= grid.length) return state;
  if (grid[cell] === state.brush) return state;

  const next = grid.slice();
  next[cell] = state.brush;
  return withCurrentGrid(state, next);
}

/** Clears the selected part in the selected frame. Nothing else. */
export function clearPart(state: EditorState): EditorState {
  if (currentGrid(state).every((cell) => cell === 0)) return state;
  return withCurrentGrid(state, blankGrid());
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

export function canAddFrame(state: EditorState): boolean {
  return state.frames.length < SKIN_SPEC.maxFramesPerPart;
}

/**
 * Adds a frame after the selected one, as a copy of it, and selects the copy.
 * A copy, because the next frame of an animation is nearly always the last one
 * with something moved; starting from blank would mean redrawing the rest.
 */
export function addFrame(state: EditorState): EditorState {
  if (!canAddFrame(state)) return state;
  const copy = currentFrame(state);
  const frames = [
    ...state.frames.slice(0, state.frame + 1),
    copy,
    ...state.frames.slice(state.frame + 1),
  ];
  return { ...state, frames, frame: state.frame + 1 };
}

/** Removes the selected frame. The last remaining frame cannot be removed. */
export function removeFrame(state: EditorState): EditorState {
  if (state.frames.length <= 1) return state;
  const frames = state.frames.filter((_, index) => index !== state.frame);
  return { ...state, frames, frame: Math.min(state.frame, frames.length - 1) };
}

/** Sets how long the selected frame shows. Anything the format would refuse is ignored. */
export function setDuration(state: EditorState, durationMs: number): EditorState {
  if (
    !Number.isInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > SKIN_SPEC.maxFrameDurationMs
  ) {
    return state;
  }
  if (currentDuration(state) === durationMs) return state;
  const frames = state.frames.map((frame, index) =>
    index === state.frame ? { ...frame, durationMs } : frame,
  );
  return { ...state, frames };
}

// ---------------------------------------------------------------------------
// Palette
//
// Two different things can be done to a palette, and they are kept apart here
// as they are on screen. Adding a colour changes nothing that is already
// drawn. Remaking one changes every cell that uses it, in every part and every
// frame — which is the point of storing cells as palette numbers, and also why
// it should never happen by accident.
// ---------------------------------------------------------------------------

/** The same errors, in the same shape, that `parseSkin` would give for the palette. */
export type PaletteError = Extract<
  SkinError,
  { kind: "bad_palette_id" | "duplicate_palette_id" | "bad_hex" | "too_many" }
>;

/** An id nobody has used yet: `color-1`, `color-2`, … */
export function suggestColourId(state: EditorState): string {
  const used = new Set(state.palette.map((entry) => entry.id));
  for (let n = 1; ; n++) {
    const id = `color-${n}`;
    if (!used.has(id)) return id;
  }
}

/** Adds a colour to the end of the palette and picks it up as the brush. */
export function addColour(
  state: EditorState,
  id: string,
  hex: string,
): Result<EditorState, PaletteError> {
  if (state.palette.length >= SKIN_SPEC.maxPaletteEntries) {
    return err({
      kind: "too_many",
      what: "palette",
      got: state.palette.length + 1,
      max: SKIN_SPEC.maxPaletteEntries,
    });
  }
  if (!SKIN_SPEC.paletteIdPattern.test(id)) return err({ kind: "bad_palette_id", id });
  if (state.palette.some((entry) => entry.id === id)) {
    return err({ kind: "duplicate_palette_id", id });
  }
  if (!SKIN_SPEC.hexPattern.test(hex)) return err({ kind: "bad_hex", hex });

  const palette = [...state.palette, { id, hex }];
  return ok({ ...state, palette, brush: palette.length });
}

/**
 * Remakes a colour: every cell painted with it changes, everywhere. The cells
 * themselves are not touched — they hold the number, and the number now means
 * something else.
 */
export function recolour(state: EditorState, paletteIndex: number, hex: string): EditorState {
  const entry = state.palette[paletteIndex - 1];
  if (entry === undefined || !SKIN_SPEC.hexPattern.test(hex) || entry.hex === hex) return state;
  const palette = state.palette.map((existing, index) =>
    index === paletteIndex - 1 ? { id: existing.id, hex } : existing,
  );
  return { ...state, palette };
}

// ---------------------------------------------------------------------------
// To and from the format
// ---------------------------------------------------------------------------

/** What gets sent to the API. Every part gets every frame, run-length packed. */
export function toSkin(state: EditorState): Skin {
  return {
    formatVersion: 1,
    name: state.name.trim(),
    palette: state.palette.map((entry) => ({ id: entry.id, hex: entry.hex })),
    parts: PART_SLOTS.map((slot) => ({
      slot,
      frames: state.frames.map((frame) => packFrame(frame.grids[slot], frame.durationMs)),
    })),
  };
}

/**
 * Opens a stored skin for editing.
 *
 * The format allows each part its own number of frames, and a part with fewer
 * loops round (that is how `<Sprite frame>` draws it). The editor has one row
 * of frames, so a shorter part is written out in full: frame for frame it
 * draws the same, it just stops relying on the loop.
 */
export function fromSkin(skin: Skin): EditorState {
  const framesOf = (slot: PartSlot) => skin.parts.find((part) => part.slot === slot)?.frames ?? [];
  const count = Math.max(1, ...PART_SLOTS.map((slot) => framesOf(slot).length));

  const frames: EditorFrame[] = [];
  for (let index = 0; index < count; index++) {
    const grids = gridsFrom((slot) => {
      const own = framesOf(slot);
      const frame = own[index % Math.max(1, own.length)];
      return frame === undefined ? blankGrid() : expandFrame(frame);
    });
    // The duration of this frame comes from the first part that has a frame of
    // its own at this position.
    const timed = PART_SLOTS.map((slot) => framesOf(slot)[index]).find(
      (frame) => frame !== undefined,
    );
    frames.push({ durationMs: timed?.durationMs ?? DEFAULT_FRAME_MS, grids });
  }

  return {
    name: skin.name,
    palette: skin.palette.map((entry) => ({ id: entry.id, hex: entry.hex })),
    frames,
    slot: "body",
    frame: 0,
    brush: skin.palette.length > 0 ? 1 : 0,
  };
}

/**
 * The drawing as it will look, for the editor's own previews.
 *
 * This is the same `toRenderable` the server runs when a skin is saved, on the
 * same data, so a preview cannot drift from what gets stored. It is not what
 * the saved-skin view shows, though: that one is drawn from the server's
 * answer, which is the only evidence that a skin was really stored.
 */
export function draw(state: EditorState): RenderableSkin {
  return toRenderable(toSkin(state));
}
