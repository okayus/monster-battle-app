import { describe, expect, it } from "vitest";

import type { Direction, GameMap, Position } from "@mba/core";

import type { ApiError } from "../api.js";
import {
  arrived,
  canSearch,
  exitRefused,
  hasMoved,
  inGrass,
  isStored,
  leaving,
  onExit,
  tileUnder,
  walk,
  wantsExit,
} from "./model.js";
import type { Walk } from "./model.js";

// ---------------------------------------------------------------------------
// A map small enough to read:
//
//        0123
//      0 .gT.      . path   g grass   T tree
//      1 .E..      E a path tile with an exit on it
// ---------------------------------------------------------------------------

const EXIT: Position = { x: 1, y: 1 };

const MAP: GameMap = {
  id: "here",
  name: "ここ",
  width: 4,
  height: 2,
  tiles: ["path", "grass", "tree", "path", "path", "path", "path", "path"],
  spawn: { x: 0, y: 0 },
  exits: [{ at: EXIT, to: { mapId: "there", position: { x: 0, y: 0 } } }],
};

const REFUSED: ApiError = { kind: "no_exit_here", status: 400 };

function at(x: number, y: number): Walk {
  return arrived(MAP, { x, y });
}

function stepped(state: Walk, ...dirs: Direction[]): Walk {
  return dirs.reduce((now, dir) => walk(now, { kind: "stepped", dir }), state);
}

/** The save for the position on screen has come back. */
function confirmed(state: Walk): Walk {
  return walk(state, { kind: "position_confirmed", at: state.position });
}

// ---------------------------------------------------------------------------

describe("arriving", () => {
  it("puts the player where the server said, with nothing going on", () => {
    const start = { x: 0, y: 0 };
    const state = arrived(MAP, start);
    expect(state.position).toBe(start);
    expect(state.confirmed).toBe(start);
    expect(state).toMatchObject({
      saving: null,
      search: { kind: "idle" },
      travel: { kind: "idle" },
      asked: null,
    });
  });

  it("is not moving: there is nothing to save, and the server already has the position", () => {
    const state = at(0, 0);
    expect(hasMoved(state)).toBe(false);
    expect(isStored(state)).toBe(true);
  });
});

describe("stepping", () => {
  it("moves the player one tile", () => {
    expect(stepped(at(0, 0), "right").position).toEqual({ x: 1, y: 0 });
    expect(stepped(at(0, 0), "down").position).toEqual({ x: 0, y: 1 });
    expect(stepped(at(0, 0), "right", "down", "left", "up").position).toEqual({ x: 0, y: 0 });
  });

  it("gives back the very state it was given when a tree or the edge is in the way", () => {
    const beside = at(1, 0);
    expect(walk(beside, { kind: "stepped", dir: "right" })).toBe(beside); // (2,0) is a tree
    expect(walk(beside, { kind: "stepped", dir: "up" })).toBe(beside); // off the top

    const corner = at(3, 1);
    expect(walk(corner, { kind: "stepped", dir: "right" })).toBe(corner);
    expect(walk(corner, { kind: "stepped", dir: "down" })).toBe(corner);
  });

  it("does not change the state it was given", () => {
    const before = at(0, 0);
    const copy = structuredClone(before);
    stepped(before, "right");
    expect(before).toEqual(copy);
  });

  it("counts as having moved, also when it leads back onto the tile the player started on", () => {
    expect(hasMoved(stepped(at(0, 0), "right"))).toBe(true);

    const back = stepped(at(0, 0), "right", "left");
    expect(back.position).toEqual(back.start);
    // The same tile, and still something the server has to be told.
    expect(hasMoved(back)).toBe(true);
  });

  it("leaves the save status and the server's position as they were", () => {
    const saved = walk(at(0, 0), { kind: "save_reported", status: { kind: "saved" } });
    const next = stepped(saved, "right");
    expect(next.saving).toEqual({ kind: "saved" });
    expect(next.confirmed).toBe(saved.confirmed);
  });
});

describe("whether the server has the position on screen", () => {
  it("is no until the save for that position comes back", () => {
    const moved = stepped(at(0, 0), "right");
    expect(isStored(moved)).toBe(false);
    expect(isStored(confirmed(moved))).toBe(true);
  });

  it("is still no when the save that came back was for an earlier step", () => {
    const first = stepped(at(0, 0), "down");
    const second = stepped(first, "right");
    // The burst of steps: the request for the first one returns while the
    // player is already on the second.
    const answered = walk(second, { kind: "position_confirmed", at: first.position });
    expect(answered.confirmed).toBe(first.position);
    expect(isStored(answered)).toBe(false);
    expect(isStored(confirmed(answered))).toBe(true);
  });

  it("is not read off the save status, which is about the step before", () => {
    const saved = walk(confirmed(stepped(at(0, 0), "down")), {
      kind: "save_reported",
      status: { kind: "saved" },
    });
    expect(isStored(saved)).toBe(true);

    // One more step. Nothing has been reported about it yet, so the status
    // still says "saved" — and the server does not have this position.
    const further = stepped(saved, "right");
    expect(further.saving).toEqual({ kind: "saved" });
    expect(isStored(further)).toBe(false);
  });

  it("records what the saver reports, and nothing else changes", () => {
    const before = stepped(at(0, 0), "right");
    for (const status of [
      { kind: "saving" },
      { kind: "saved" },
      { kind: "failed", error: { kind: "network" } },
    ] as const) {
      const after = walk(before, { kind: "save_reported", status });
      expect(after).toEqual({ ...before, saving: status });
    }
  });
});

describe("searching the grass", () => {
  /** In the grass at (1,0), with the server knowing it. */
  const inTheGrass = () => confirmed(stepped(at(0, 0), "right"));

  it("knows what the player is standing on", () => {
    expect(tileUnder(at(0, 0))).toBe("path");
    expect(inGrass(at(0, 0))).toBe(false);
    expect(tileUnder(inTheGrass())).toBe("grass");
    expect(inGrass(inTheGrass())).toBe(true);
  });

  it("is possible in grass the server knows the player is in", () => {
    expect(canSearch(inTheGrass())).toBe(true);
  });

  it("is not possible anywhere else", () => {
    expect(canSearch(at(0, 0))).toBe(false);
    expect(canSearch(confirmed(stepped(at(0, 0), "down")))).toBe(false);
  });

  it("waits for the step into the grass to be saved: the server starts the battle from what it has stored", () => {
    const justStepped = stepped(at(0, 0), "right");
    expect(inGrass(justStepped)).toBe(true);
    expect(canSearch(justStepped)).toBe(false);
  });

  it("is not possible twice at once, and is again after a refusal", () => {
    const searching = walk(inTheGrass(), { kind: "search_started" });
    expect(searching.search).toEqual({ kind: "asking" });
    expect(canSearch(searching)).toBe(false);

    const refused = walk(searching, { kind: "search_failed", error: REFUSED });
    expect(refused.search).toEqual({ kind: "failed", error: REFUSED });
    expect(canSearch(refused)).toBe(true);
  });

  it("can be done on the grass a player arrived on", () => {
    expect(canSearch(at(1, 0))).toBe(true);
  });
});

describe("going through an exit", () => {
  /** Stepped onto the exit from (0,1), and the server has that step. */
  const onTheExit = () => confirmed(stepped(at(0, 1), "right"));

  it("knows when the player is on one", () => {
    expect(onExit(at(0, 1))).toBe(false);
    expect(onExit(onTheExit())).toBe(true);
  });

  it("is asked for once the step onto it has been saved, and not before", () => {
    const justStepped = stepped(at(0, 1), "right");
    expect(onExit(justStepped)).toBe(true);
    expect(wantsExit(justStepped)).toBe(false);
    expect(wantsExit(confirmed(justStepped))).toBe(true);
  });

  it("is not asked for on any other tile", () => {
    expect(wantsExit(confirmed(stepped(at(0, 0), "right")))).toBe(false);
  });

  it("is not asked for by arriving on one: an exit is taken by stepping onto it", () => {
    const arrivedOnIt = arrived(MAP, EXIT);
    expect(onExit(arrivedOnIt)).toBe(true);
    expect(isStored(arrivedOnIt)).toBe(true);
    expect(wantsExit(arrivedOnIt)).toBe(false);
  });

  it("is asked for after stepping off the exit one arrived on, and back onto it", () => {
    const back = stepped(arrived(MAP, EXIT), "right", "left");
    expect(back.position).toEqual(EXIT);
    expect(wantsExit(back)).toBe(false);
    expect(wantsExit(confirmed(back))).toBe(true);
  });

  it("is asked for once: asking makes it stop wanting to", () => {
    const asked = walk(onTheExit(), { kind: "travel_started" });
    expect(asked.asked).toBe(asked.position);
    expect(wantsExit(asked)).toBe(false);
  });

  it("holds the player still while the server is taking them through", () => {
    const going = walk(onTheExit(), { kind: "travel_started" });
    expect(leaving(going)).toBe(true);
    for (const dir of ["up", "down", "left", "right"] as const) {
      expect(walk(going, { kind: "stepped", dir })).toBe(going);
    }
  });

  it("is not on the way anywhere before it was asked for, or after it was refused", () => {
    expect(leaving(onTheExit())).toBe(false);
    const refused = walk(walk(onTheExit(), { kind: "travel_started" }), {
      kind: "travel_failed",
      error: REFUSED,
    });
    expect(leaving(refused)).toBe(false);
  });

  describe("when the server refuses", () => {
    const refused = () =>
      walk(walk(onTheExit(), { kind: "travel_started" }), {
        kind: "travel_failed",
        error: REFUSED,
      });

    it("says why, for as long as the player stands on that exit", () => {
      expect(exitRefused(refused())).toEqual(REFUSED);
      expect(exitRefused(stepped(refused(), "right"))).toBeNull();
    });

    it("has nothing to say when nothing was refused", () => {
      expect(exitRefused(onTheExit())).toBeNull();
      expect(exitRefused(walk(onTheExit(), { kind: "travel_started" }))).toBeNull();
    });

    it("does not ask again for the same step", () => {
      expect(wantsExit(refused())).toBe(false);
      // Nor when something else happens while the player stands there.
      const later = walk(refused(), { kind: "save_reported", status: { kind: "saved" } });
      expect(wantsExit(later)).toBe(false);
    });

    it("lets the player walk on, and asks again when they step back onto it", () => {
      const off = stepped(refused(), "right");
      expect(off.position).toEqual({ x: 2, y: 1 });
      expect(wantsExit(confirmed(off))).toBe(false);

      const on = stepped(confirmed(off), "left");
      expect(wantsExit(on)).toBe(false);
      expect(wantsExit(confirmed(on))).toBe(true);
    });
  });
});
