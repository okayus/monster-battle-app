/**
 * The map: tiles drawn as a CSS grid, and a player who walks on them.
 *
 * Movement is decided here, in the browser, by the same `step()` the server
 * has (`@mba/core`), so walking is instant and never waits for a request. The
 * server still has the last word on what is *stored*: every new position goes
 * to PUT /api/save, which refuses anywhere a player could not have walked to.
 *
 * Going to another map is the opposite. Nothing about it is decided here: the
 * screen asks the server to take the player through the exit they are on,
 * waits for the answer, and then loads whatever the server says is true now.
 *
 * What the screen knows and how that changes is in `model.ts`, as pure
 * functions. This file draws the state, and does the three things a pure
 * function cannot: listen for keys, send requests, and change the address.
 */

import { useCallback, useEffect, useReducer, useState } from "react";
import type { CSSProperties } from "react";

import { ok } from "@mba/core";
import type { Direction, GameMap, Position, Result, TileKind } from "@mba/core";

import { fetchMap, fetchSave, putSave, startBattle, travelThroughExit } from "../api.js";
import type { ApiError } from "../api.js";
import { Loaded, remember, useSettled } from "../loaded.js";
import { fetchWornLook } from "../look/load.js";
import type { WornLook } from "../look/load.js";
import { Playing } from "../Playing.js";
import { hrefs } from "../route.js";
import { createSaver } from "../saver.js";
import type { SaveStatus } from "../saver.js";
import {
  arrived,
  canSearch,
  exitRefused,
  hasMoved,
  inGrass,
  leaving,
  walk,
  wantsExit,
} from "./model.js";

/** Where the player is, with the map that is on. */
interface Arrival {
  map: GameMap;
  start: Position;
}

/** The save says which map the player is on, so it is fetched first. */
async function arrive(): Promise<Result<Arrival, ApiError>> {
  const save = await fetchSave();
  if (!save.ok) return save;
  const map = await fetchMap(save.value.mapId);
  if (!map.ok) return map;
  return ok({ map: map.value, start: save.value.position });
}

/**
 * Everything one arrival asks the server for, started together.
 *
 * What the player looks like is asked for beside the map, not before it:
 * walking does not wait for a picture.
 *
 * Both requests are started here, by the screen, and handed down as promises
 * (loaded.tsx). Nothing further down makes one.
 */
function requests(count: number) {
  return { count, loading: remember(arrive()), worn: remember(fetchWornLook()) };
}

export function MapScreen() {
  /** `count` goes up by one each time the player has gone through an exit. */
  const [arrival, setArrival] = useState(() => requests(0));

  // After an exit, the screen is loaded the way it is loaded when it is
  // opened: the save, then the map it names. What is on screen after
  // travelling is therefore what a reload would show, by construction.
  //
  // The next arrival takes the screen only once its answer is in. Until
  // then the map the player left stays up, instead of giving way to
  // "loading".
  const onTravelled = useCallback(() => {
    const next = requests(arrival.count + 1);
    void next.loading.then(() => setArrival(next));
  }, [arrival.count]);

  return (
    <Loaded
      from={arrival.loading}
      waiting={<p>読み込み中…</p>}
      failed={(error) => <p role="alert">マップを読み込めなかった（{error.kind}）</p>}
    >
      {({ map, start }) => (
        // Keyed by arrival, so each one starts from a fresh position and
        // saver — also when an exit leads to another tile of the same map.
        <MapView
          key={arrival.count}
          map={map}
          start={start}
          wearing={arrival.worn}
          onTravelled={onTravelled}
        />
      )}
    </Loaded>
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

function MapView({
  map,
  start,
  wearing,
  onTravelled,
}: {
  map: GameMap;
  start: Position;
  /** What the player looks like, on its way or already here. */
  wearing: Promise<Result<WornLook, ApiError>>;
  /** Called once the server has taken the player through an exit. */
  onTravelled: () => void;
}) {
  const [state, dispatch] = useReducer(walk, arrived(map, start));
  const { position } = state;

  // Read here and not in the marker, because the marker is a new element on
  // every tile the player steps onto. Null until it has loaded, and for good
  // if it could not be.
  const look = useSettled(wearing);
  const worn = look?.ok ? look.value : null;

  // One saver for the life of this view. It serialises the saves, so a burst
  // of steps cannot leave an older position stored last (see saver.ts).
  const [save] = useState(() =>
    createSaver(
      async (at: Position) => {
        const result = await putSave({ mapId: map.id, position: at });
        if (result.ok) dispatch({ kind: "position_confirmed", at });
        return result;
      },
      (status) => dispatch({ kind: "save_reported", status }),
    ),
  );

  const moved = hasMoved(state);
  useEffect(() => {
    if (moved) save(position);
  }, [moved, position, save]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dir = KEYS[event.key];
      if (dir === undefined) return;
      // Leave browser shortcuts alone (Alt+Left is "back", for one).
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault(); // otherwise the arrow keys scroll the page
      dispatch({ kind: "stepped", dir });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // When to ask is the model's to say (`wantsExit`). Saying "asked" first is
  // what makes it false again, so this runs once for each step onto an exit.
  const asking = wantsExit(state);
  useEffect(() => {
    if (!asking) return;
    dispatch({ kind: "travel_started" });
    void travelThroughExit().then((result) => {
      // On success this view has done its part, and stays as it is until the
      // next one replaces it.
      if (result.ok) onTravelled();
      else dispatch({ kind: "travel_failed", error: result.error });
    });
  }, [asking, onTravelled]);

  const searchGrass = async () => {
    dispatch({ kind: "search_started" });
    const result = await startBattle();
    if (!result.ok) {
      dispatch({ kind: "search_failed", error: result.error });
      return;
    }
    // The battle has an address, like everything else worth coming back to.
    window.location.hash = hrefs.battle(result.value.id);
  };

  const move = (dir: Direction) => dispatch({ kind: "stepped", dir });

  const playerIndex = position.y * map.width + position.x;
  /** Which tiles have a way out, by their place in the grid. */
  const exits = new Set(map.exits.map((exit) => exit.at.y * map.width + exit.at.x));
  const grass = inGrass(state);
  const refused = exitRefused(state);

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
        現在地: ({position.x}, {position.y}) <span role="status">{saveText(state.saving)}</span>
      </p>
      <p>
        <button type="button" disabled={!canSearch(state)} onClick={() => void searchGrass()}>
          {state.search.kind === "asking" ? "さがしている…" : "草むらを調べる"}
        </button>{" "}
        {grass ? "野生のモンスターがいそうだ。" : "草むらに入ると、野生のモンスターを探せる。"}
      </p>
      {state.search.kind === "failed" && (
        <p role="alert">バトルを始められなかった（{state.search.error.kind}）</p>
      )}
      {leaving(state) && <p data-travelling>となりのマップへ移っている…</p>}
      {/* Only while still on the exit: stepping off and on again is how to try again. */}
      {refused !== null && <p role="alert">出口を通れなかった（{refused.kind}）</p>}
      <p>
        矢印キーか WASD、または上のボタンで歩く。
        {map.exits.length > 0 && "暗い四角は出口。乗ると、つながった先へ移る。"}
      </p>
    </section>
  );
}
