/**
 * The map: tiles drawn as a CSS grid, and a player who walks on them.
 *
 * Movement is decided here, in the browser, by the same `step()` the server
 * has (`@mba/core`), so walking is instant and never waits for a request. The
 * server still has the last word on what is *stored*: every new position goes
 * to PUT /api/save, which refuses anywhere a player cannot stand.
 */

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { step } from "@mba/core";
import type { Direction, GameMap, Position, TileKind } from "@mba/core";

import { fetchMap, fetchSave, putSave } from "./api.js";
import type { ApiError } from "./api.js";
import { createSaver } from "./saver.js";
import type { SaveStatus } from "./saver.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "failed"; error: ApiError }
  | { kind: "ready"; map: GameMap; start: Position };

/** The save says which map the player is on, so it is fetched first. */
async function load(): Promise<LoadState> {
  const save = await fetchSave();
  if (!save.ok) return { kind: "failed", error: save.error };
  const map = await fetchMap(save.value.mapId);
  if (!map.ok) return { kind: "failed", error: map.error };
  return { kind: "ready", map: map.value, start: save.value.position };
}

export function MapScreen() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void load().then((next) => {
      // The requests can outlive the component (and StrictMode's first mount).
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") return <p>読み込み中…</p>;
  if (state.kind === "failed") {
    return <p role="alert">マップを読み込めなかった（{state.error.kind}）</p>;
  }
  // Keyed by map, so a different map starts from a fresh position and saver.
  return <MapView key={state.map.id} map={state.map} start={state.start} />;
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

const player: CSSProperties = {
  width: "60%",
  height: "60%",
  borderRadius: "50%",
  background: "#e8463c",
  border: "2px solid #ffffff",
  boxSizing: "border-box",
};

const controls: CSSProperties = { display: "flex", gap: "0.5rem", margin: "0.75rem 0" };

function saveText(status: SaveStatus<ApiError> | null): string {
  if (status === null) return "";
  if (status.kind === "saving") return "保存中…";
  if (status.kind === "saved") return "保存済み";
  return `保存できなかった（${status.error.kind}）`;
}

function MapView({ map, start }: { map: GameMap; start: Position }) {
  const [position, setPosition] = useState(start);
  const [saveStatus, setSaveStatus] = useState<SaveStatus<ApiError> | null>(null);

  // One saver for the life of this view. It serialises the saves, so a burst
  // of steps cannot leave an older position stored last (see saver.ts).
  const [save] = useState(() =>
    createSaver((at: Position) => putSave({ mapId: map.id, position: at }), setSaveStatus),
  );

  // `step` is pure, and it returns the very same object when the way is
  // blocked. React then sees no state change at all: no render, and no save.
  const move = (dir: Direction) => setPosition((at) => step(at, dir, map));

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
      setPosition((at) => step(at, dir, map));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [map]);

  const playerIndex = position.y * map.width + position.x;

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
            {i === playerIndex && <div data-player style={player} />}
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
      <p>矢印キーか WASD、または上のボタンで歩く。</p>
    </section>
  );
}
