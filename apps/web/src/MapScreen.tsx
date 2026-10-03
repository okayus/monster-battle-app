/**
 * The map: tiles drawn as a CSS grid, and a player who walks on them.
 *
 * Movement is decided here, in the browser, by the same `step()` the server
 * has (`@mba/core`), so walking is instant and never waits for a request. The
 * server still has the last word on what is *stored*: every new position goes
 * to PUT /api/save, which refuses anywhere a player cannot stand.
 *
 * Going to another map is the opposite. Nothing about it is decided here: the
 * screen asks the server to take the player through the exit they are on,
 * waits for the answer, and then loads whatever the server says is true now.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { exitAt, hasWildMonsters, step } from "@mba/core";
import type { Direction, GameMap, Position, TileKind } from "@mba/core";

import { fetchMap, fetchSave, putSave, startBattle, travelThroughExit } from "./api.js";
import type { ApiError } from "./api.js";
import { fetchWornLook } from "./look/load.js";
import type { WornLook } from "./look/load.js";
import { Playing } from "./Playing.js";
import { hrefs } from "./route.js";
import { createSaver } from "./saver.js";
import type { SaveStatus } from "./saver.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "failed"; error: ApiError }
  /** `arrival` counts the times the player has arrived somewhere: 0 on opening the screen. */
  | { kind: "ready"; map: GameMap; start: Position; arrival: number };

/** The save says which map the player is on, so it is fetched first. */
async function load(arrival: number): Promise<LoadState> {
  const save = await fetchSave();
  if (!save.ok) return { kind: "failed", error: save.error };
  const map = await fetchMap(save.value.mapId);
  if (!map.ok) return { kind: "failed", error: map.error };
  return { kind: "ready", map: map.value, start: save.value.position, arrival };
}

export function MapScreen() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  /** Goes up by one each time the player has gone through an exit. */
  const [arrival, setArrival] = useState(0);

  // After an exit, the screen is loaded the way it is loaded when it is
  // opened: the save, then the map it names. What is on screen after
  // travelling is therefore what a reload would show, by construction. Until
  // the answer is in, the map the player left stays up.
  useEffect(() => {
    let cancelled = false;
    void load(arrival).then((next) => {
      // The requests can outlive the component (and StrictMode's first mount).
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [arrival]);

  const onTravelled = useCallback(() => setArrival((count) => count + 1), []);

  if (state.kind === "loading") return <p>読み込み中…</p>;
  if (state.kind === "failed") {
    return <p role="alert">マップを読み込めなかった（{state.error.kind}）</p>;
  }
  // Keyed by arrival, so each one starts from a fresh position and saver —
  // also when an exit leads to another tile of the same map.
  return (
    <MapView key={state.arrival} map={state.map} start={state.start} onTravelled={onTravelled} />
  );
}

// ---------------------------------------------------------------------------

/** A Record, so a tile kind without a colour is a type error rather than a blank square. */
const TILE_COLOURS: Record<TileKind, string> = {
  path: "#d9c79a",
  grass: "#7fbf6a",
  tree: "#2f6b3a",
  water: "#4a90d9",
};

const KEYS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
};

const TILE_SIZE = "2rem";

const tile: CSSProperties = {
  width: TILE_SIZE,
  height: TILE_SIZE,
  display: "grid",
  placeItems: "center",
};

const dot: CSSProperties = {
  width: "60%",
  height: "60%",
  borderRadius: "50%",
  background: "#e8463c",
  border: "2px solid #ffffff",
  boxSizing: "border-box",
};

// The <svg> has a viewBox and no size of its own, so it fills the tile.
const figure: CSSProperties = { width: "100%", height: "100%", lineHeight: 0 };

/** A way out, drawn on the tile it is on: a dark doorway. */
const door: CSSProperties = {
  width: "70%",
  height: "70%",
  background: "#3b2a1a",
  border: "2px solid #f2e3b3",
  boxSizing: "border-box",
};

/**
 * The player, on the tile they stand on: drawn in what they are wearing, or as
 * a plain dot until that has loaded — and for good if it cannot be. A missing
 * picture is not worth stopping a walk for.
 */
function PlayerMarker({ worn }: { worn: WornLook | null }) {
  if (worn === null) return <div data-player style={dot} />;
  return (
    <div data-player style={figure}>
      <Playing skin={worn.look} colours={worn.appearance.colours} />
    </div>
  );
}

const controls: CSSProperties = { display: "flex", gap: "0.5rem", margin: "0.75rem 0" };

function saveText(status: SaveStatus<ApiError> | null): string {
  if (status === null) return "";
  if (status.kind === "saving") return "保存中…";
  if (status.kind === "saved") return "保存済み";
  return `保存できなかった（${status.error.kind}）`;
}

type SearchState = { kind: "idle" } | { kind: "searching" } | { kind: "failed"; error: ApiError };

type TravelState = { kind: "idle" } | { kind: "travelling" } | { kind: "failed"; error: ApiError };

function MapView({
  map,
  start,
  onTravelled,
}: {
  map: GameMap;
  start: Position;
  /** Called once the server has taken the player through an exit. */
  onTravelled: () => void;
}) {
  const [position, setPosition] = useState(start);
  const [saveStatus, setSaveStatus] = useState<SaveStatus<ApiError> | null>(null);
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });
  const [travel, setTravel] = useState<TravelState>({ kind: "idle" });
  /** What the player looks like. Null until it has loaded. */
  const [worn, setWorn] = useState<WornLook | null>(null);

  // Fetched beside the map, not before it: walking does not wait for a
  // picture. It is held here and not in the marker, because the marker is a
  // new element on every tile the player steps onto.
  useEffect(() => {
    let cancelled = false;
    void fetchWornLook().then((result) => {
      if (!cancelled && result.ok) setWorn(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The position the server is known to have: the one this view was loaded
   * with, and after that each one a save came back for. The very object, so
   * that "is what is on screen what the server has" is a `===`.
   */
  const [confirmed, setConfirmed] = useState(start);

  // One saver for the life of this view. It serialises the saves, so a burst
  // of steps cannot leave an older position stored last (see saver.ts).
  const [save] = useState(() =>
    createSaver(async (at: Position) => {
      const result = await putSave({ mapId: map.id, position: at });
      if (result.ok) setConfirmed(at);
      return result;
    }, setSaveStatus),
  );

  // While the server is taking the player through an exit, they stay put. A
  // step taken now would be a save on a map they are about to have left.
  const leaving = travel.kind === "travelling";

  // `step` is pure, and it returns the very same object when the way is
  // blocked. React then sees no state change at all: no render, and no save.
  const move = (dir: Direction) => {
    if (!leaving) setPosition((at) => step(at, dir, map));
  };

  useEffect(() => {
    // `start` came from the server, so there is nothing to save until the
    // player has actually moved.
    if (position !== start) save(position);
  }, [position, start, save]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dir = KEYS[event.key];
      if (dir === undefined) return;
      // Leave browser shortcuts alone (Alt+Left is "back", for one).
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault(); // otherwise the arrow keys scroll the page
      if (!leaving) setPosition((at) => step(at, dir, map));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [map, leaving]);

  const playerIndex = position.y * map.width + position.x;
  const here = map.tiles[playerIndex];
  /** Which tiles have a way out, by their place in the grid. */
  const exits = new Set(map.exits.map((exit) => exit.at.y * map.width + exit.at.x));

  // The server starts a battle — and takes a player through an exit — from
  // the tile it has stored, not from the one this screen is showing. So both
  // wait until the two agree.
  //
  // Asked of the position itself, and not read off the save status. The status
  // is one render behind a step: for an instant after stepping it still says
  // "saved", about the step before.
  const stored = confirmed === position;
  const inGrass = here !== undefined && hasWildMonsters(here);
  const canSearch = inGrass && stored && search.kind !== "searching";

  // An exit is taken by stepping onto it. Arriving on one — the far end of a
  // door that works both ways — is not stepping onto it: `position` is still
  // the very object the server's answer was loaded into.
  const onExit = exitAt(map, position) !== undefined;
  const steppedOntoExit = onExit && position !== start;

  // One request at a time, whatever React does with this effect. Going
  // through an exit is not safe to repeat: asked twice, the server would take
  // the player through whatever exit they arrived on.
  const asking = useRef(false);

  useEffect(() => {
    // The server goes by the position it has stored, so the step onto the
    // exit has to have reached it first — the same wait as before a battle.
    if (!steppedOntoExit || !stored || asking.current) return;
    asking.current = true;
    setTravel({ kind: "travelling" });
    void travelThroughExit().then((result) => {
      if (result.ok) {
        // This view has done its part, and stays as it is until the next one
        // replaces it. It does not ask again.
        onTravelled();
        return;
      }
      asking.current = false;
      setTravel({ kind: "failed", error: result.error });
    });
  }, [steppedOntoExit, stored, onTravelled]);

  const searchGrass = async () => {
    setSearch({ kind: "searching" });
    const result = await startBattle();
    if (!result.ok) {
      setSearch({ kind: "failed", error: result.error });
      return;
    }
    // The battle has an address, like everything else worth coming back to.
    window.location.hash = hrefs.battle(result.value.id);
  };

  return (
    <section aria-label="マップ">
      <h2>{map.name}</h2>

      <div
        role="img"
        aria-label={`${map.name}。現在地は (${position.x}, ${position.y})`}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${map.width}, ${TILE_SIZE})`,
          width: "fit-content",
          border: "1px solid #888",
        }}
      >
        {/* The grid never reorders, so a tile's position is a stable key. */}
        {map.tiles.map((kind, i) => (
          <div key={i} data-tile={kind} style={{ ...tile, background: TILE_COLOURS[kind] }}>
            {i === playerIndex ? (
              <PlayerMarker worn={worn} />
            ) : (
              exits.has(i) && <div data-exit style={door} />
            )}
          </div>
        ))}
      </div>

      <div style={controls} role="group" aria-label="移動">
        <button type="button" aria-label="左へ" onClick={() => move("left")}>
          ←
        </button>
        <button type="button" aria-label="上へ" onClick={() => move("up")}>
          ↑
        </button>
        <button type="button" aria-label="下へ" onClick={() => move("down")}>
          ↓
        </button>
        <button type="button" aria-label="右へ" onClick={() => move("right")}>
          →
        </button>
      </div>

      <p>
        現在地: ({position.x}, {position.y}) <span role="status">{saveText(saveStatus)}</span>
      </p>
      <p>
        <button type="button" disabled={!canSearch} onClick={() => void searchGrass()}>
          {search.kind === "searching" ? "さがしている…" : "草むらを調べる"}
        </button>{" "}
        {inGrass ? "野生のモンスターがいそうだ。" : "草むらに入ると、野生のモンスターを探せる。"}
      </p>
      {search.kind === "failed" && (
        <p role="alert">バトルを始められなかった（{search.error.kind}）</p>
      )}
      {leaving && <p data-travelling>となりのマップへ移っている…</p>}
      {/* Only while still on the exit: stepping off and on again is how to try again. */}
      {travel.kind === "failed" && onExit && (
        <p role="alert">出口を通れなかった（{travel.error.kind}）</p>
      )}
      <p>
        矢印キーか WASD、または上のボタンで歩く。
        {map.exits.length > 0 && "暗い四角は出口。乗ると、つながった先へ移る。"}
      </p>
    </section>
  );
}
