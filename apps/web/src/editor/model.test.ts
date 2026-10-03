import { describe, expect, it } from "vitest";

import {
  CELLS_PER_FRAME,
  PART_SLOTS,
  SKIN_SPEC,
  packFrame,
  parseSkin,
  toRenderable,
} from "@mba/sprite";
import type { PartSlot, Skin } from "@mba/sprite";

import {
  DEFAULT_FRAME_MS,
  addColour,
  addFrame,
  canAddFrame,
  clearPart,
  currentDuration,
  currentGrid,
  fromSkin,
  newEditor,
  paint,
  recolour,
  removeFrame,
  rename,
  selectBrush,
  selectFrame,
  selectSlot,
  setDuration,
  suggestColourId,
  toSkin,
  usageOf,
} from "./model.js";
import type { EditorState } from "./model.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seeded PRNG. The property tests must fail reproducibly or they are noise. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The skin as the server would see it: after the trip through JSON. */
function received(skin: Skin): unknown {
  return JSON.parse(JSON.stringify(skin));
}

function accepted(state: EditorState): Skin {
  const result = parseSkin(received(toSkin(state)));
  if (!result.ok) throw new Error(`the validator rejected it: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Paints several cells, one after another. */
function paintAll(state: EditorState, cells: number[]): EditorState {
  return cells.reduce(paint, state);
}

/** How many cells of a part are painted, in one frame. */
function painted(state: EditorState, slot: PartSlot, frame: number): number {
  return (state.frames[frame]?.grids[slot] ?? []).filter((cell) => cell !== 0).length;
}

/** A named editor with something drawn on two parts. */
function drawn(): EditorState {
  let state = rename(newEditor(), "テスト");
  state = paintAll(state, [0, 1, 2, 17]);
  state = selectBrush(selectSlot(state, "hair"), 2);
  return paintAll(state, [5, 6]);
}

// ---------------------------------------------------------------------------

describe("newEditor", () => {
  it("starts with one empty frame, on the body, holding the first colour", () => {
    const state = newEditor();
    expect(state.frames).toHaveLength(1);
    expect(state.slot).toBe("body");
    expect(state.brush).toBe(1);
    for (const slot of PART_SLOTS) {
      expect(state.frames[0]?.grids[slot]).toHaveLength(CELLS_PER_FRAME);
      expect(painted(state, slot, 0)).toBe(0);
    }
  });

  it("is something the server accepts as soon as it has a name", () => {
    expect(parseSkin(received(toSkin(newEditor()))).ok).toBe(false);
    expect(accepted(rename(newEditor(), "なまえ")).name).toBe("なまえ");
  });
});

describe("paint", () => {
  it("paints the selected part in the selected frame, and nothing else", () => {
    let state = addFrame(newEditor());
    state = selectSlot(state, "shirt");
    state = paint(state, 40);

    expect(state.frames[1]?.grids.shirt[40]).toBe(1);
    expect(painted(state, "shirt", 1)).toBe(1);
    expect(painted(state, "shirt", 0)).toBe(0);
    for (const slot of PART_SLOTS.filter((s) => s !== "shirt")) {
      expect(painted(state, slot, 1)).toBe(0);
    }
  });

  it("hands back the very same state when the cell already has that colour", () => {
    const once = paint(newEditor(), 3);
    expect(paint(once, 3)).toBe(once);
  });

  it("erases with brush 0", () => {
    const state = paint(selectBrush(paint(newEditor(), 3), 0), 3);
    expect(currentGrid(state)[3]).toBe(0);
  });

  it.each([-1, CELLS_PER_FRAME, 1.5, Number.NaN])("ignores a cell that is not one (%s)", (cell) => {
    const state = newEditor();
    expect(paint(state, cell)).toBe(state);
  });

  it("does not change the state it was given", () => {
    const before = newEditor();
    const grid = currentGrid(before);
    paint(before, 9);
    expect(currentGrid(before)).toBe(grid);
    expect(grid[9]).toBe(0);
  });
});

describe("clearPart", () => {
  it("clears the selected part in the selected frame only", () => {
    const state = drawn();
    const cleared = clearPart(state);
    expect(painted(cleared, "hair", 0)).toBe(0);
    expect(painted(cleared, "body", 0)).toBe(4);
  });

  it("hands back the same state when there is nothing to clear", () => {
    const state = newEditor();
    expect(clearPart(state)).toBe(state);
  });
});

describe("choosing what to work on", () => {
  it("switches part, frame and brush", () => {
    const state = addFrame(newEditor());
    expect(selectSlot(state, "shoes").slot).toBe("shoes");
    expect(selectFrame(state, 0).frame).toBe(0);
    expect(selectBrush(state, 3).brush).toBe(3);
  });

  it("ignores a frame or a colour that does not exist", () => {
    const state = newEditor();
    expect(selectFrame(state, 1)).toBe(state);
    expect(selectFrame(state, -1)).toBe(state);
    expect(selectBrush(state, state.palette.length + 1)).toBe(state);
    expect(selectBrush(state, -1)).toBe(state);
  });

  it("hands back the same state when nothing changes", () => {
    const state = newEditor();
    expect(selectSlot(state, "body")).toBe(state);
    expect(selectFrame(state, 0)).toBe(state);
    expect(selectBrush(state, 1)).toBe(state);
  });
});

describe("frames", () => {
  it("adds a copy of the selected frame after it, and selects the copy", () => {
    const state = addFrame(drawn());
    expect(state.frames).toHaveLength(2);
    expect(state.frame).toBe(1);
    expect(state.frames[1]).toEqual(state.frames[0]);
  });

  it("keeps the copy and the original apart once one of them is painted", () => {
    let state = addFrame(drawn());
    state = paint(selectSlot(state, "body"), 100);
    expect(state.frames[1]?.grids.body[100]).toBe(2);
    expect(state.frames[0]?.grids.body[100]).toBe(0);
  });

  it("inserts in the middle, not at the end", () => {
    let state = addFrame(addFrame(newEditor())); // three frames, on the third
    state = setDuration(selectFrame(state, 0), 500);
    state = addFrame(state);
    expect(state.frames.map((frame) => frame.durationMs)).toEqual([500, 500, 120, 120]);
    expect(state.frame).toBe(1);
  });

  it("stops at the limit the format sets", () => {
    let state = newEditor();
    for (let n = 1; n < SKIN_SPEC.maxFramesPerPart; n++) state = addFrame(state);
    expect(state.frames).toHaveLength(SKIN_SPEC.maxFramesPerPart);
    expect(canAddFrame(state)).toBe(false);
    expect(addFrame(state)).toBe(state);
    expect(accepted(rename(state, "いっぱい")).parts[0]?.frames).toHaveLength(
      SKIN_SPEC.maxFramesPerPart,
    );
  });

  it("removes the selected frame, and never the last one", () => {
    let state = addFrame(addFrame(newEditor()));
    state = setDuration(state, 300); // the third frame
    state = removeFrame(selectFrame(state, 0));
    expect(state.frames.map((frame) => frame.durationMs)).toEqual([120, 300]);
    expect(state.frame).toBe(0);

    state = removeFrame(selectFrame(state, 1));
    expect(state.frames).toHaveLength(1);
    expect(state.frame).toBe(0);
    expect(removeFrame(state)).toBe(state);
  });

  it("sets how long the selected frame shows", () => {
    const state = setDuration(addFrame(newEditor()), 250);
    expect(currentDuration(state)).toBe(250);
    expect(state.frames[0]?.durationMs).toBe(DEFAULT_FRAME_MS);
  });

  it.each([0, -5, SKIN_SPEC.maxFrameDurationMs + 1, 16.7, Number.NaN])(
    "ignores a duration the format would refuse (%s)",
    (durationMs) => {
      const state = newEditor();
      expect(setDuration(state, durationMs)).toBe(state);
    },
  );
});

describe("adding a colour", () => {
  it("puts it at the end, picks it up as the brush, and changes nothing already drawn", () => {
    const before = drawn();
    const result = addColour(before, "shoes", "#7a4a2a");
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    expect(result.value.palette.at(-1)).toEqual({ id: "shoes", hex: "#7a4a2a" });
    expect(result.value.brush).toBe(result.value.palette.length);
    expect(result.value.frames).toBe(before.frames);
  });

  it.each([
    ["uppercase", "Shoes"],
    ["a space", "my shoes"],
    ["an underscore", "shoes_2"],
    ["empty", ""],
    ["over 32 characters", "s".repeat(33)],
  ])("refuses an id with %s, as the server would", (_label, id) => {
    expect(addColour(newEditor(), id, "#123456")).toEqual({
      ok: false,
      error: { kind: "bad_palette_id", id },
    });
  });

  it("refuses an id that is already in the palette", () => {
    expect(addColour(newEditor(), "hair", "#123456")).toEqual({
      ok: false,
      error: { kind: "duplicate_palette_id", id: "hair" },
    });
  });

  it.each(["red", "#fff", "#12345g", "url(#x)"])("refuses %s as a colour", (hex) => {
    expect(addColour(newEditor(), "new", hex)).toEqual({
      ok: false,
      error: { kind: "bad_hex", hex },
    });
  });

  it("stops at the limit the format sets", () => {
    let state = newEditor();
    while (state.palette.length < SKIN_SPEC.maxPaletteEntries) {
      const result = addColour(state, suggestColourId(state), "#123456");
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      state = result.value;
    }
    expect(addColour(state, "one-more", "#123456")).toEqual({
      ok: false,
      error: {
        kind: "too_many",
        what: "palette",
        got: SKIN_SPEC.maxPaletteEntries + 1,
        max: SKIN_SPEC.maxPaletteEntries,
      },
    });
    expect(accepted(rename(state, "いっぱい")).palette).toHaveLength(SKIN_SPEC.maxPaletteEntries);
  });

  it("suggests an id nobody has used", () => {
    const state = newEditor();
    expect(suggestColourId(state)).toBe("color-1");
    const result = addColour(state, "color-1", "#123456");
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(suggestColourId(result.value)).toBe("color-2");
  });
});

describe("remaking a colour", () => {
  it("changes what the number means, and leaves every cell holding the number", () => {
    const before = drawn();
    const after = recolour(before, 1, "#ff0000");

    expect(after.palette[0]).toEqual({ id: "skin", hex: "#ff0000" });
    expect(after.palette.slice(1)).toEqual(before.palette.slice(1));
    expect(after.frames).toBe(before.frames);
  });

  it("reaches every part and frame that uses it, in what gets drawn", () => {
    let state = selectBrush(selectSlot(drawn(), "shirt"), 1);
    state = paint(addFrame(paint(state, 200)), 201);
    const fills = (s: EditorState) =>
      JSON.stringify(toRenderable(toSkin(s))).match(/#[0-9a-f]{6}/g) ?? [];

    expect(fills(state)).toContain("#e8b98a");
    const after = recolour(state, 1, "#ff0000");
    expect(fills(after)).not.toContain("#e8b98a");
    expect(usageOf(after, 1).parts).toEqual(["body", "shirt"]);
  });

  it.each([
    ["a colour that is not in the palette", 9, "#ff0000"],
    ["the eraser", 0, "#ff0000"],
    ["something that is not a colour", 1, "red"],
    ["the colour it already is", 1, "#e8b98a"],
  ])("hands back the same state for %s", (_label, index, hex) => {
    const state = newEditor();
    expect(recolour(state, index, hex)).toBe(state);
  });
});

describe("usageOf", () => {
  it("counts the cells and names the parts, over every frame", () => {
    let state = drawn(); // body: 4 cells of colour 1; hair: 2 cells of colour 2
    state = addFrame(selectSlot(state, "body")); // the copy has the same 4 again
    expect(usageOf(state, 1)).toEqual({ cells: 8, parts: ["body"] });
    expect(usageOf(state, 2)).toEqual({ cells: 4, parts: ["hair"] });
    expect(usageOf(state, 3)).toEqual({ cells: 0, parts: [] });
  });
});

describe("toSkin", () => {
  it("is already in the form the server stores, so nothing is rewritten on the way in", () => {
    const sent = toSkin(drawn());
    expect(accepted(drawn())).toEqual(sent);
  });

  it("gives every part every frame", () => {
    const skin = toSkin(addFrame(addFrame(drawn())));
    expect(skin.parts.map((part) => part.slot)).toEqual([...PART_SLOTS]);
    for (const part of skin.parts) expect(part.frames).toHaveLength(3);
  });

  it("trims the name it sends", () => {
    expect(toSkin(rename(newEditor(), "  なまえ  ")).name).toBe("なまえ");
  });
});

describe("fromSkin", () => {
  it("opens what the editor saved, exactly as it was drawn", () => {
    let state = addFrame(drawn());
    state = setDuration(paint(selectSlot(state, "pants"), 250), 400);

    const reopened = fromSkin(accepted(state));
    expect(reopened.name).toBe(state.name);
    expect(reopened.palette).toEqual(state.palette);
    expect(reopened.frames).toEqual(state.frames);
    expect(toSkin(reopened)).toEqual(toSkin(state));
  });

  it("starts on the first frame of the body, holding the first colour", () => {
    const reopened = fromSkin(toSkin(selectBrush(selectSlot(addFrame(drawn()), "shoes"), 0)));
    expect(reopened).toMatchObject({ slot: "body", frame: 0, brush: 1 });
  });

  it("writes out a part that relied on looping, frame for frame", () => {
    // The body has three frames and the hair has one, which the format allows:
    // drawn by frame number, the hair shows its one frame under all three.
    const body = (cell: number) => {
      const grid = new Array<number>(CELLS_PER_FRAME).fill(0);
      grid[cell] = 1;
      return packFrame(grid, 200);
    };
    const blank = { durationMs: 90, cells: [[0, CELLS_PER_FRAME]] };
    const parsed = parseSkin({
      formatVersion: 1,
      name: "ふぞろい",
      palette: [{ id: "skin", hex: "#e8b98a" }],
      parts: PART_SLOTS.map((slot) => ({
        slot,
        frames:
          slot === "body"
            ? [body(0), body(1), body(2)]
            : slot === "hair"
              ? [
                  {
                    durationMs: 90,
                    cells: [
                      [1, 2],
                      [0, CELLS_PER_FRAME - 2],
                    ],
                  },
                ]
              : [blank],
      })),
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));

    const state = fromSkin(parsed.value);
    expect(state.frames).toHaveLength(3);
    expect(state.frames.map((frame) => frame.durationMs)).toEqual([200, 200, 200]);
    state.frames.forEach((frame, index) => {
      expect(frame.grids.body.indexOf(1)).toBe(index);
      expect(frame.grids.hair.slice(0, 3)).toEqual([1, 1, 0]);
    });

    // Frame for frame, it still draws what the original drew.
    const original = toRenderable(parsed.value);
    const rewritten = toRenderable(accepted(state));
    for (const slot of PART_SLOTS) {
      const before = original.parts.find((part) => part.slot === slot)?.frames ?? [];
      const after = rewritten.parts.find((part) => part.slot === slot)?.frames ?? [];
      for (let index = 0; index < 3; index++) {
        expect(after[index]?.rects).toEqual(before[index % before.length]?.rects);
      }
    }
  });

  it("opens the skins that ship with the game: one frame, drawn on the body", () => {
    const blank = { durationMs: 120, cells: [[0, CELLS_PER_FRAME]] };
    const parsed = parseSkin({
      formatVersion: 1,
      name: "モンスター",
      palette: [{ id: "body", hex: "#6fae4f" }],
      parts: PART_SLOTS.map((slot) => ({
        slot,
        frames: [slot === "body" ? { durationMs: 120, cells: [[1, CELLS_PER_FRAME]] } : blank],
      })),
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    const state = fromSkin(parsed.value);
    expect(state.frames).toHaveLength(1);
    expect(painted(state, "body", 0)).toBe(CELLS_PER_FRAME);
  });
});

describe("whatever is done in the editor", () => {
  it("always leaves something the server accepts, and that reopens as it was", () => {
    const rand = mulberry32(0xed170f);
    const pick = (n: number) => Math.floor(rand() * n);

    for (let run = 0; run < 40; run++) {
      let state = rename(newEditor(), `run ${run}`);

      for (let step = 0; step < 120; step++) {
        const action = pick(10);
        if (action <= 3) state = paint(state, pick(CELLS_PER_FRAME));
        else if (action === 4)
          state = selectSlot(state, PART_SLOTS[pick(PART_SLOTS.length)] ?? "body");
        else if (action === 5) state = selectBrush(state, pick(state.palette.length + 1));
        else if (action === 6) state = rand() < 0.7 ? addFrame(state) : removeFrame(state);
        else if (action === 7) state = selectFrame(state, pick(state.frames.length));
        else if (action === 8) state = setDuration(state, 1 + pick(2000));
        else {
          const added = addColour(state, suggestColourId(state), "#abcdef");
          state = added.ok
            ? recolour(added.value, 1 + pick(added.value.palette.length), "#fedcba")
            : state;
        }

        // The selections always point at something that exists.
        expect(state.frame).toBeLessThan(state.frames.length);
        expect(state.brush).toBeLessThanOrEqual(state.palette.length);
      }

      const stored = accepted(state);
      expect(stored).toEqual(toSkin(state));
      expect(toSkin(fromSkin(stored))).toEqual(stored);
    }
  });
});
