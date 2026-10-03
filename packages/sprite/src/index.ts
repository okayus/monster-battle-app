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
  /**
   * `name` is rendered as text, never as markup, so it is not an injection
   * surface — but an unbounded string is still storage someone else pays for.
   */
  maxNameLength: 64,
  /** A frame that lingers for minutes is a typo, not an animation. */
  maxFrameDurationMs: 10_000,
  /** Palette ids become CSS custom property names (`--c-<id>`), so they are strict. */
  paletteIdPattern: /^[a-z0-9-]{1,32}$/,
  /** Palette colours land in a `fill` attribute, so only plain hex is allowed. */
  hexPattern: /^#[0-9a-fA-F]{6}$/,
} as const;

/**
 * Cells in one frame. Every frame's run lengths must add up to exactly this —
 * that single equality is what pins the canvas to 16×16.
 */
export const CELLS_PER_FRAME = SKIN_SPEC.canvasSize * SKIN_SPEC.canvasSize;

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
// Cell grids — a frame with the run-length encoding undone
// ---------------------------------------------------------------------------

/**
 * One palette index per cell, row-major, `CELLS_PER_FRAME` long. 0 is transparent.
 *
 * This is the shape the editor paints into and the shape the rectangle merger
 * reads. It is never stored or transferred: `Frame` is the stored form, and
 * this expands to roughly 60× its size in JSON.
 */
export type CellGrid = readonly number[];

/** Reads a cell. Out of range counts as transparent, so callers stay total. */
function cellAt(grid: CellGrid, i: number): number {
  return grid[i] ?? 0;
}

/**
 * Undoes the run-length encoding.
 *
 * Runs past the end of the canvas are dropped rather than throwing: a Frame
 * that came through `parseSkin` sums to exactly CELLS_PER_FRAME, and one that
 * did not is a caller's bug, not untrusted input.
 */
export function expandFrame(frame: Frame): number[] {
  const grid = new Array<number>(CELLS_PER_FRAME).fill(0);
  let i = 0;
  for (const [paletteIndex, runLength] of frame.cells) {
    for (let n = 0; n < runLength && i < CELLS_PER_FRAME; n++) {
      grid[i] = paletteIndex;
      i++;
    }
  }
  return grid;
}

/**
 * Re-encodes a grid. The inverse of `expandFrame`, up to canonicalisation:
 * adjacent runs of the same colour always come back merged, so a Frame that
 * split one colour across two runs is not byte-identical after a round trip —
 * it draws identically, which is the property that matters.
 */
export function packFrame(grid: CellGrid, durationMs: number): Frame {
  const cells: [number, number][] = [];
  let i = 0;
  while (i < grid.length) {
    const paletteIndex = cellAt(grid, i);
    let runLength = 1;
    while (i + runLength < grid.length && cellAt(grid, i + runLength) === paletteIndex) {
      runLength++;
    }
    cells.push([paletteIndex, runLength]);
    i += runLength;
  }
  return { durationMs, cells };
}

/**
 * Merges same-coloured neighbours into rectangles, greedily: widen along the
 * row first, then deepen while the whole width still matches.
 *
 * Not the minimal rectangle cover — finding that is expensive, and this runs on
 * every save. For hand-drawn 16×16 art it removes the great majority of the
 * cells, which is the point. Transparent cells produce no rectangle at all.
 */
function toRects(grid: CellGrid): Rect[] {
  const size = SKIN_SPEC.canvasSize;
  const rects: Rect[] = [];
  const taken = new Array<boolean>(CELLS_PER_FRAME).fill(false);

  /** True if the `width` cells starting at `start` are all free and this colour. */
  const runIsFree = (start: number, width: number, paletteIndex: number): boolean => {
    for (let dx = 0; dx < width; dx++) {
      if (taken[start + dx] === true) return false;
      if (cellAt(grid, start + dx) !== paletteIndex) return false;
    }
    return true;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const head = y * size + x;
      if (taken[head] === true) continue;
      const paletteIndex = cellAt(grid, head);
      if (paletteIndex === 0) continue; // transparent: nothing to draw

      let w = 1;
      while (x + w < size && runIsFree(head + w, 1, paletteIndex)) w++;

      let h = 1;
      while (y + h < size && runIsFree(head + h * size, w, paletteIndex)) h++;

      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          taken[(y + dy) * size + x + dx] = true;
        }
      }
      rects.push([x, y, w, h, paletteIndex]);
    }
  }
  return rects;
}

// ---------------------------------------------------------------------------
// Validation — the trust boundary
// ---------------------------------------------------------------------------

export type SkinError =
  /** Wrong type or wrong shape. `at` is a path into the input, for the message. */
  | { kind: "malformed"; at: string }
  | { kind: "too_large"; bytes: number; max: number }
  | { kind: "too_many"; what: string; got: number; max: number }
  | { kind: "bad_cell_count"; slot: PartSlot; frame: number; got: number }
  | { kind: "bad_palette_id"; id: string }
  | { kind: "duplicate_palette_id"; id: string }
  | { kind: "bad_hex"; hex: string }
  | { kind: "bad_palette_index"; slot: PartSlot; frame: number; index: number }
  | { kind: "missing_slot"; slot: PartSlot };

const PART_SLOT_SET: ReadonlySet<string> = new Set(PART_SLOTS);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Validates untrusted input and returns a Skin. This is the only place user
 * input becomes a Skin, so it is also the security boundary — nothing
 * downstream re-checks.
 *
 * The returned Skin is rebuilt field by field rather than cast or spread, so
 * properties the caller did not ask about cannot ride along into storage.
 */
export function parseSkin(input: unknown): Result<Skin, SkinError> {
  // Size first, on the canonical serialization — that is what actually gets
  // stored, and it bounds every loop below.
  const json: string | undefined = safeStringify(input);
  if (json === undefined) return err({ kind: "malformed", at: "$" });
  const bytes = utf8ByteLength(json);
  if (bytes > SKIN_SPEC.maxBytes) {
    return err({ kind: "too_large", bytes, max: SKIN_SPEC.maxBytes });
  }

  if (!isObject(input)) return err({ kind: "malformed", at: "$" });
  if (input.formatVersion !== 1) return err({ kind: "malformed", at: "$.formatVersion" });

  const name = input.name;
  if (typeof name !== "string" || name.length === 0) {
    return err({ kind: "malformed", at: "$.name" });
  }
  if (name.length > SKIN_SPEC.maxNameLength) {
    return err({ kind: "too_many", what: "name", got: name.length, max: SKIN_SPEC.maxNameLength });
  }

  const palette = parsePalette(input.palette);
  if (!palette.ok) return palette;

  const parts = parseParts(input.parts, palette.value.length);
  if (!parts.ok) return parts;

  return ok({ formatVersion: 1, name, palette: palette.value, parts: parts.value });
}

/**
 * UTF-8 byte length, counted by hand rather than with `TextEncoder`.
 *
 * This package is imported by the API, both SPAs and the editor, and assumes
 * nothing beyond the language itself — no Node globals, no DOM. One small
 * function is a cheaper price than an ambient dependency in the one package
 * that everything else depends on.
 */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        // A surrogate pair is one code point, and four bytes rather than six.
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** `JSON.stringify` throws on cycles and BigInt, and returns undefined for undefined. */
function safeStringify(input: unknown): string | undefined {
  try {
    return JSON.stringify(input);
  } catch {
    return undefined;
  }
}

function parsePalette(raw: unknown): Result<PaletteEntry[], SkinError> {
  if (!Array.isArray(raw) || raw.length === 0) return err({ kind: "malformed", at: "$.palette" });
  if (raw.length > SKIN_SPEC.maxPaletteEntries) {
    return err({
      kind: "too_many",
      what: "palette",
      got: raw.length,
      max: SKIN_SPEC.maxPaletteEntries,
    });
  }

  const palette: PaletteEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const entry: unknown = raw[i];
    if (!isObject(entry)) return err({ kind: "malformed", at: `$.palette[${i}]` });

    const { id, hex } = entry;
    if (typeof id !== "string") return err({ kind: "malformed", at: `$.palette[${i}].id` });
    if (!SKIN_SPEC.paletteIdPattern.test(id)) return err({ kind: "bad_palette_id", id });
    // Ids address colours from outside the skin (`--c-<id>`), so a duplicate
    // would make "recolour the hair" ambiguous.
    if (seen.has(id)) return err({ kind: "duplicate_palette_id", id });

    if (typeof hex !== "string") return err({ kind: "malformed", at: `$.palette[${i}].hex` });
    if (!SKIN_SPEC.hexPattern.test(hex)) return err({ kind: "bad_hex", hex });

    seen.add(id);
    palette.push({ id, hex });
  }
  return ok(palette);
}

function parseParts(raw: unknown, paletteSize: number): Result<Part[], SkinError> {
  if (!Array.isArray(raw)) return err({ kind: "malformed", at: "$.parts" });
  if (raw.length > PART_SLOTS.length) {
    return err({ kind: "too_many", what: "parts", got: raw.length, max: PART_SLOTS.length });
  }

  const bySlot = new Map<PartSlot, Part>();
  for (let i = 0; i < raw.length; i++) {
    const part: unknown = raw[i];
    if (!isObject(part)) return err({ kind: "malformed", at: `$.parts[${i}]` });

    const slot = part.slot;
    if (typeof slot !== "string" || !PART_SLOT_SET.has(slot)) {
      return err({ kind: "malformed", at: `$.parts[${i}].slot` });
    }
    const known = slot as PartSlot;
    if (bySlot.has(known)) return err({ kind: "malformed", at: `$.parts[${i}].slot` });

    const frames = parseFrames(part.frames, known, paletteSize, `$.parts[${i}]`);
    if (!frames.ok) return frames;
    bySlot.set(known, { slot: known, frames: frames.value });
  }

  // Rebuilt in PART_SLOTS order, not the order they arrived in: the array order
  // *is* the draw order, so leaving it to the client would let a skin put its
  // hair behind the body.
  const parts: Part[] = [];
  for (const slot of PART_SLOTS) {
    const part = bySlot.get(slot);
    if (part === undefined) return err({ kind: "missing_slot", slot });
    parts.push(part);
  }
  return ok(parts);
}

function parseFrames(
  raw: unknown,
  slot: PartSlot,
  paletteSize: number,
  path: string,
): Result<Frame[], SkinError> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return err({ kind: "malformed", at: `${path}.frames` });
  }
  if (raw.length > SKIN_SPEC.maxFramesPerPart) {
    return err({
      kind: "too_many",
      what: `${path}.frames`,
      got: raw.length,
      max: SKIN_SPEC.maxFramesPerPart,
    });
  }

  const frames: Frame[] = [];
  for (let f = 0; f < raw.length; f++) {
    const frame: unknown = raw[f];
    const at = `${path}.frames[${f}]`;
    if (!isObject(frame)) return err({ kind: "malformed", at });

    const durationMs = frame.durationMs;
    if (!isInt(durationMs) || durationMs <= 0 || durationMs > SKIN_SPEC.maxFrameDurationMs) {
      return err({ kind: "malformed", at: `${at}.durationMs` });
    }

    const cells = parseCells(frame.cells, slot, f, paletteSize, at);
    if (!cells.ok) return cells;
    frames.push({ durationMs, cells: cells.value });
  }
  return ok(frames);
}

function parseCells(
  raw: unknown,
  slot: PartSlot,
  frame: number,
  paletteSize: number,
  path: string,
): Result<[number, number][], SkinError> {
  if (!Array.isArray(raw)) return err({ kind: "malformed", at: `${path}.cells` });

  const cells: [number, number][] = [];
  let total = 0;
  for (let c = 0; c < raw.length; c++) {
    const run: unknown = raw[c];
    const at = `${path}.cells[${c}]`;
    if (!Array.isArray(run) || run.length !== 2) return err({ kind: "malformed", at });

    const [paletteIndex, runLength] = run as [unknown, unknown];
    if (!isInt(paletteIndex) || paletteIndex < 0) return err({ kind: "malformed", at: `${at}[0]` });
    // 0 is transparent and n is palette[n - 1], so paletteSize itself is in range.
    if (paletteIndex > paletteSize) {
      return err({ kind: "bad_palette_index", slot, frame, index: paletteIndex });
    }
    if (!isInt(runLength) || runLength <= 0) return err({ kind: "malformed", at: `${at}[1]` });

    total += runLength;
    cells.push([paletteIndex, runLength]);
  }

  // The one equality that pins the canvas to 16×16.
  if (total !== CELLS_PER_FRAME) return err({ kind: "bad_cell_count", slot, frame, got: total });
  return ok(cells);
}

// ---------------------------------------------------------------------------
// Derivation — run once at write time, never on the read path
// ---------------------------------------------------------------------------

/** Expands the run-length cells and merges same-coloured neighbours into rects. */
export function toRenderable(skin: Skin): RenderableSkin {
  return {
    formatVersion: 1,
    palette: skin.palette.map((entry) => ({ id: entry.id, hex: entry.hex })),
    parts: skin.parts.map((part) => ({
      slot: part.slot,
      frames: part.frames.map((frame) => ({
        durationMs: frame.durationMs,
        rects: toRects(expandFrame(frame)),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Appearances — how skins are worn
// ---------------------------------------------------------------------------

/**
 * What a character looks like, as a recipe over skins that already exist:
 * which skin is worn, which slots are taken from another skin instead, and
 * which colours are worn in place of the drawn ones.
 *
 * It holds identifiers and colours and nothing else. Dyeing the hair adds one
 * entry here; no skin is copied, and no drawing is stored a second time
 * (docs/03-data-model.md).
 */
export interface Appearance {
  /** The skin that is worn. Every slot comes from it unless `parts` says otherwise. */
  skinId: string;
  /** Slots drawn from another skin instead: slot → that skin's id. */
  parts: Partial<Record<PartSlot, string>>;
  /**
   * Colours worn in place of the drawn ones — a small palette laid over the
   * skins' own. An id here is a role ("hair"), not a place in one skin's
   * palette: it recolours every part of the look that was painted with that
   * id, whichever skin the part came from.
   *
   * A list of entries rather than an object keyed by id, like a skin's
   * palette. Ids are chosen by users, and "constructor" is a valid one; on an
   * object it would be found on every lookup, set or not.
   */
  colours: PaletteEntry[];
}

export const APPEARANCE_SPEC = {
  /** As many colours as a single skin can have. */
  maxColours: SKIN_SPEC.maxPaletteEntries,
  /** Skin ids are the server's own. This only bounds the string that is looked up. */
  maxSkinIdLength: 64,
} as const;

export type AppearanceError =
  /** Wrong type or wrong shape. `at` is a path into the input, as in `SkinError`. */
  | { kind: "malformed"; at: string }
  | { kind: "too_many"; what: string; got: number; max: number }
  | { kind: "bad_palette_id"; id: string }
  | { kind: "duplicate_palette_id"; id: string }
  | { kind: "bad_hex"; hex: string };

function isSkinId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= APPEARANCE_SPEC.maxSkinIdLength
  );
}

/**
 * Validates untrusted input and returns an Appearance. The second trust
 * boundary in this package, and it is here for the same reason as the first:
 * a colour's id becomes the name of a CSS custom property and its hex becomes
 * that property's value, so both are held to exactly the patterns a skin's
 * palette is held to.
 *
 * What this cannot decide is whether the skins it names exist, or whether the
 * look has the colours it recolours. Both depend on what is stored, and are
 * the caller's to check.
 *
 * As with `parseSkin`, the result is rebuilt field by field, so nothing the
 * validator did not look at can ride along into storage.
 */
export function parseAppearance(input: unknown): Result<Appearance, AppearanceError> {
  if (!isObject(input)) return err({ kind: "malformed", at: "$" });

  const skinId = input.skinId;
  if (!isSkinId(skinId)) return err({ kind: "malformed", at: "$.skinId" });

  const rawParts = input.parts;
  if (!isObject(rawParts)) return err({ kind: "malformed", at: "$.parts" });
  for (const key of Object.keys(rawParts)) {
    if (!PART_SLOT_SET.has(key)) return err({ kind: "malformed", at: "$.parts" });
  }
  const parts: Partial<Record<PartSlot, string>> = {};
  for (const slot of PART_SLOTS) {
    const from = rawParts[slot];
    if (from === undefined) continue;
    if (!isSkinId(from)) return err({ kind: "malformed", at: `$.parts.${slot}` });
    // "The hair of the skin that is worn anyway" says nothing, so it is not
    // kept: one look has one way of being written down.
    if (from !== skinId) parts[slot] = from;
  }

  const rawColours = input.colours;
  if (!Array.isArray(rawColours)) return err({ kind: "malformed", at: "$.colours" });
  if (rawColours.length > APPEARANCE_SPEC.maxColours) {
    return err({
      kind: "too_many",
      what: "colours",
      got: rawColours.length,
      max: APPEARANCE_SPEC.maxColours,
    });
  }
  const colours: PaletteEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawColours.length; i++) {
    const entry: unknown = rawColours[i];
    if (!isObject(entry)) return err({ kind: "malformed", at: `$.colours[${i}]` });

    const { id, hex } = entry;
    if (typeof id !== "string") return err({ kind: "malformed", at: `$.colours[${i}].id` });
    if (!SKIN_SPEC.paletteIdPattern.test(id)) return err({ kind: "bad_palette_id", id });
    if (seen.has(id)) return err({ kind: "duplicate_palette_id", id });

    if (typeof hex !== "string") return err({ kind: "malformed", at: `$.colours[${i}].hex` });
    if (!SKIN_SPEC.hexPattern.test(hex)) return err({ kind: "bad_hex", hex });

    seen.add(id);
    colours.push({ id, hex });
  }

  return ok({ skinId, parts, colours });
}

/** The skins a recipe names, each once: the worn one first, then the parts' in draw order. */
export function skinsNamedBy(appearance: Pick<Appearance, "skinId" | "parts">): string[] {
  const ids = [appearance.skinId];
  for (const slot of PART_SLOTS) {
    const from = appearance.parts[slot];
    if (from !== undefined && !ids.includes(from)) ids.push(from);
  }
  return ids;
}

/**
 * Puts a look together: every slot from the worn skin, except the slots the
 * recipe takes from another.
 *
 * The result is an ordinary RenderableSkin, so whatever draws a skin draws a
 * look. Each part keeps its own frames and timings. The palettes of the skins
 * that contribute are laid end to end and the parts' colour numbers shifted to
 * match — which means the same id can appear twice, once per skin, each with
 * the colour that skin was drawn in.
 *
 * The recipe's colours are not applied here. They stay CSS variables, set
 * wherever the look is drawn, which is why a recolour never touches data.
 *
 * `skins` holds the render-ready form of the skins the recipe names. A slot
 * whose skin is missing falls back to the worn skin's own part. If the worn
 * skin itself is missing there is nothing to draw, and the answer is undefined.
 */
export function composeAppearance(
  appearance: Pick<Appearance, "skinId" | "parts">,
  skins: ReadonlyMap<string, RenderableSkin>,
): RenderableSkin | undefined {
  const worn = skins.get(appearance.skinId);
  if (worn === undefined) return undefined;

  const palette: PaletteEntry[] = [];
  /** Where each contributing skin's palette starts in the combined one. */
  const offsets = new Map<RenderableSkin, number>();
  const parts: RenderableSkin["parts"] = [];

  // PART_SLOTS order, back to front: the draw order is part of the format, not
  // something a recipe gets to choose.
  for (const slot of PART_SLOTS) {
    const from = appearance.parts[slot];
    const source = (from === undefined ? undefined : skins.get(from)) ?? worn;
    const part = source.parts.find((candidate) => candidate.slot === slot);
    if (part === undefined) continue;

    let offset = offsets.get(source);
    if (offset === undefined) {
      offset = palette.length;
      offsets.set(source, offset);
      for (const entry of source.palette) palette.push({ id: entry.id, hex: entry.hex });
    }
    const shift = offset;
    parts.push({
      slot,
      frames: part.frames.map((frame) => ({
        durationMs: frame.durationMs,
        rects: frame.rects.map(([x, y, w, h, index]): Rect => [x, y, w, h, index + shift]),
      })),
    });
  }
  return { formatVersion: 1, palette, parts };
}

/**
 * The colours something is actually painted with, one entry per id: what a
 * recolour can name, and what a screen can offer to recolour.
 *
 * A palette entry no cell uses is left out — recolouring it would change
 * nothing. Where two skins in a look share an id, the first one's colour
 * stands for it.
 */
export function coloursOf(skin: RenderableSkin): PaletteEntry[] {
  const used = new Set<number>();
  for (const part of skin.parts) {
    for (const frame of part.frames) {
      for (const rect of frame.rects) used.add(rect[4]);
    }
  }

  const colours: PaletteEntry[] = [];
  const seen = new Set<string>();
  skin.palette.forEach((entry, i) => {
    if (!used.has(i + 1) || seen.has(entry.id)) return;
    seen.add(entry.id);
    colours.push({ id: entry.id, hex: entry.hex });
  });
  return colours;
}

// ---------------------------------------------------------------------------
// Playback — which frame is on screen at a given time
// ---------------------------------------------------------------------------

/**
 * The index of the frame that is showing `elapsedMs` after a looping timeline
 * started.
 *
 * Takes anything with a `durationMs`, so it serves the editable frames and the
 * render-ready ones alike. Pure on purpose: the clock belongs to whoever is
 * drawing, and this only answers "given that time, which frame".
 *
 * Total for any input: an empty timeline, or one whose durations add up to
 * nothing, answers 0, and so does a time that is not a number.
 */
export function frameAt(
  frames: ReadonlyArray<{ readonly durationMs: number }>,
  elapsedMs: number,
): number {
  let total = 0;
  for (const frame of frames) total += Math.max(0, frame.durationMs);
  if (total <= 0 || !Number.isFinite(elapsedMs)) return 0;

  // Wrapped into [0, total), for times before the start as well as after it.
  let remaining = ((elapsedMs % total) + total) % total;
  for (let i = 0; i < frames.length; i++) {
    const duration = Math.max(0, frames[i]?.durationMs ?? 0);
    if (remaining < duration) return i;
    remaining -= duration;
  }
  // Only floating-point dust gets here; the end of the loop is the last frame.
  return frames.length - 1;
}
