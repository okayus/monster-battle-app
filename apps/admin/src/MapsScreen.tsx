/**
 * Maps: the list, and an editor that paints tiles.
 *
 * The editor mirrors a few of the server's rules while painting — the spawn
 * stays on a tile that can be stood on — so that mistakes show up under the
 * brush instead of after pressing save. The server still checks the whole map
 * with `checkMap`, and that check is the one that counts.
 */

import { useEffect, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";

import { MAP_LIMITS, TILE_KINDS, err, ok } from "@mba/core";
import type { AdminMap, AdminSpecies, Result, TileKind } from "@mba/core";

import { createMap, describeError, fetchMaps, fetchSpecies, updateMap } from "./api.js";
import type { ApiError } from "./api.js";
import {
  blankMapForm,
  hasExit,
  mapFormOf,
  moveSpawn,
  paintTile,
  setExitTarget,
  setWeight,
  toMapInput,
  toggleExit,
} from "./forms.js";
import type { MapForm } from "./forms.js";
import { offered, withMark } from "./retire.js";
import { RetireControl } from "./RetireControl.js";

interface Loaded {
  maps: AdminMap[];
  species: AdminSpecies[];
}

type LoadState =
  | { kind: "loading" }
  | { kind: "failed"; error: ApiError }
  | { kind: "ready"; data: Loaded };

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; error: ApiError };

/** What a click on the grid does: paint a kind of tile, move the spawn, or put an exit down. */
type Brush = TileKind | "spawn" | "exit";

async function load(): Promise<Result<Loaded, ApiError>> {
  const [maps, species] = await Promise.all([fetchMaps(), fetchSpecies()]);
  if (!maps.ok) return err(maps.error);
  if (!species.ok) return err(species.error);
  return ok({ maps: maps.value, species: species.value });
}

export function MapsScreen() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void load().then((result) => {
      if (cancelled) return;
      setState(
        result.ok ? { kind: "ready", data: result.value } : { kind: "failed", error: result.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") return <p>読み込み中…</p>;
  if (state.kind === "failed") {
    return (
      <p role="alert">
        {state.error.kind === "forbidden"
          ? "管理者ではないので、この画面は使えない。"
          : `マップを読み込めなかった（${describeError(state.error)}）`}
      </p>
    );
  }
  return <MapEditor initial={state.data} />;
}

// ---------------------------------------------------------------------------

/**
 * The same colours the player's map screen uses. They are written out twice,
 * once in each app: two users of four colours is not yet worth a package for
 * sharing them (docs/01-architecture.md).
 */
const TILE_COLOURS: Record<TileKind, string> = {
  path: "#d9c79a",
  grass: "#7fbf6a",
  tree: "#2f6b3a",
  water: "#4a90d9",
};

const TILE_NAMES: Record<TileKind, string> = {
  path: "道",
  grass: "草むら",
  tree: "木",
  water: "水",
};

const CELL = "1.5rem";

const columns: CSSProperties = { display: "flex", gap: "3rem", flexWrap: "wrap" };
const list: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "grid",
  gap: "0.5rem",
};
const item: CSSProperties = {
  width: "100%",
  textAlign: "left",
  font: "inherit",
  padding: "0.5rem",
  cursor: "pointer",
};
const fields: CSSProperties = { display: "grid", gap: "0.75rem", justifyItems: "start" };
const row: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  flexWrap: "wrap",
  alignItems: "center",
};

const cellBase: CSSProperties = {
  width: CELL,
  height: CELL,
  padding: 0,
  border: "1px solid rgba(0, 0, 0, 0.15)",
  borderRadius: 0,
  cursor: "crosshair",
  font: "inherit",
  fontWeight: "bold",
  lineHeight: 1,
  color: "#ffffff",
};

function brushStyle(selected: boolean, colour: string): CSSProperties {
  return {
    font: "inherit",
    padding: "0.25rem 0.5rem",
    cursor: "pointer",
    background: colour,
    border: selected ? "3px solid #111" : "1px solid #888",
  };
}

function MapEditor({ initial }: { initial: Loaded }) {
  const [maps, setMaps] = useState(initial.maps);
  const { species } = initial;

  const first = maps[0];
  const [form, setForm] = useState<MapForm>(() =>
    first === undefined ? blankMapForm() : mapFormOf(first),
  );
  const [brush, setBrush] = useState<Brush>("grass");
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  /** The map in the form as the server last listed it, if it has been saved at all. */
  const listed = maps.find((map) => map.id === form.id);

  const refresh = async () => {
    const fresh = await fetchMaps();
    if (fresh.ok) setMaps(fresh.value);
  };

  /** The species that turn up on the map in the form: the ones with a weight. */
  const turningUp = Object.entries(form.weights)
    .filter(([, weight]) => weight > 0)
    .map(([speciesId]) => speciesId);

  const change = (next: (current: MapForm) => MapForm) => {
    setForm(next);
    setSave({ kind: "idle" });
  };

  const choose = (next: MapForm) => change(() => next);

  /**
   * Where a new exit leads until it is pointed somewhere else: the spawn of
   * another map, which is always a tile that can be stood on. If this is the
   * only map there is, an exit can still lead to another tile of itself.
   */
  const firstElsewhere = maps.find((map) => !map.retired && map.id !== form.id) ?? listed;

  // `paintTile` and `moveSpawn` hand back the same form when nothing changes,
  // so dragging across tiles that are already painted re-renders nothing.
  const apply = (index: number) =>
    change((current) => {
      if (brush === "spawn") return moveSpawn(current, index);
      if (brush !== "exit") return paintTile(current, index, brush);
      if (firstElsewhere === undefined) return current;
      return toggleExit(current, index, {
        mapId: firstElsewhere.id,
        position: firstElsewhere.spawn,
      });
    });

  // Painting is a stroke: it starts on press and goes on while the pointer is
  // dragged. An exit is not painted, it is put down or taken away, and doing
  // that twice undoes it — so the exit brush acts once, on the click.
  const strokes = brush !== "exit";

  const startStroke = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    // A touch pointer is captured by the element it lands on. Released, it
    // fires pointerenter on the cells it is dragged across, as a mouse does.
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (strokes) apply(index);
  };

  const continueStroke = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    // `buttons` is 1 only while the primary button (or a finger) is down.
    if (strokes && event.buttons === 1) apply(index);
  };

  const submit = async () => {
    setSave({ kind: "saving" });
    const input = toMapInput(form);
    const result = form.id === null ? await createMap(input) : await updateMap(form.id, input);
    if (!result.ok) {
      setSave({ kind: "failed", error: result.error });
      return;
    }
    // Show what the server stored, and ask for the list again: both are the
    // server's, not this form's.
    setForm(mapFormOf(result.value));
    await refresh();
    setSave({ kind: "saved" });
  };

  const spawnIndex = form.spawn.y * form.width + form.spawn.x;

  return (
    <section aria-label="マップ">
      <h2>マップ</h2>
      <div style={columns}>
        <div>
          <ul style={list} aria-label="マップの一覧">
            {maps.map((map) => (
              <li key={map.id}>
                <button
                  type="button"
                  style={{ ...item, opacity: map.retired ? 0.55 : 1 }}
                  aria-pressed={form.id === map.id}
                  onClick={() => choose(mapFormOf(map))}
                >
                  <strong>{withMark(map.name, map.retired)}</strong>
                  <br />
                  {map.width} × {map.height}
                </button>
              </li>
            ))}
          </ul>
          <p>
            <button type="button" onClick={() => choose(blankMapForm())}>
              新しいマップ
            </button>
          </p>
        </div>

        <form
          style={fields}
          aria-label="マップのフォーム"
          onSubmit={(event) => {
            event.preventDefault();
            if (save.kind !== "saving") void submit();
          }}
        >
          <h3>{form.id === null ? "新しいマップ" : "マップを編集"}</h3>

          <label>
            名前{" "}
            <input
              value={form.name}
              maxLength={MAP_LIMITS.maxNameLength}
              onChange={(event) => change((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <div style={row} role="group" aria-label="筆">
            {TILE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={brush === kind}
                style={brushStyle(brush === kind, TILE_COLOURS[kind])}
                onClick={() => setBrush(kind)}
              >
                {TILE_NAMES[kind]}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={brush === "spawn"}
              style={brushStyle(brush === "spawn", "#ffffff")}
              onClick={() => setBrush("spawn")}
            >
              開始位置
            </button>
            <button
              type="button"
              aria-pressed={brush === "exit"}
              style={brushStyle(brush === "exit", "#3b2a1a")}
              onClick={() => setBrush("exit")}
            >
              <span style={{ color: "#f2e3b3" }}>出口</span>
            </button>
          </div>

          <div
            role="group"
            aria-label="タイル"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${form.width}, ${CELL})`,
              border: "1px solid #888",
              // Without this a touch drag scrolls the page instead of painting.
              touchAction: "none",
            }}
          >
            {/* The grid never reorders, so a tile's position is a stable key. */}
            {form.tiles.map((kind, index) => (
              <button
                key={index}
                type="button"
                data-tile={kind}
                data-spawn={index === spawnIndex ? "" : undefined}
                data-exit={hasExit(form, index) ? "" : undefined}
                aria-label={`${index % form.width},${Math.floor(index / form.width)} ${TILE_NAMES[kind]}`}
                style={{ ...cellBase, background: TILE_COLOURS[kind] }}
                onPointerDown={startStroke(index)}
                onPointerEnter={continueStroke(index)}
                // Keyboard activation arrives as a click, not as a pointer event.
                onClick={() => apply(index)}
              >
                {index === spawnIndex ? "S" : ""}
                {hasExit(form, index) ? "→" : ""}
              </button>
            ))}
          </div>
          <p>
            S が開始位置、→ が出口。{form.width} × {form.height}（大きさは変えられない）
          </p>

          <fieldset>
            <legend>出口（「出口」の筆でタイルを押すと置ける。もう一度押すと消える）</legend>
            {form.exits.length === 0 && <p style={{ margin: 0 }}>このマップから出る道は無い。</p>}
            {form.exits.map((exit) => (
              <div
                key={`${exit.at.x},${exit.at.y}`}
                style={row}
                role="group"
                aria-label={`出口 (${exit.at.x}, ${exit.at.y})`}
              >
                <span>
                  ({exit.at.x}, {exit.at.y}) から
                </span>
                <label>
                  行き先のマップ{" "}
                  <select
                    value={exit.to.mapId}
                    onChange={(event) => {
                      // A newly chosen map is entered at its spawn: the one
                      // tile of it that is certain to be standable.
                      const target = maps.find((map) => map.id === event.target.value);
                      if (target === undefined) return;
                      change((current) =>
                        setExitTarget(current, exit.at, {
                          mapId: target.id,
                          position: target.spawn,
                        }),
                      );
                    }}
                  >
                    {offered(maps, [exit.to.mapId]).map((map) => (
                      <option key={map.id} value={map.id}>
                        {withMark(map.name, map.retired)}
                      </option>
                    ))}
                  </select>
                </label>
                {(["x", "y"] as const).map((axis) => (
                  <label key={axis}>
                    行き先の {axis}{" "}
                    <input
                      type="number"
                      min={0}
                      style={{ width: "4rem" }}
                      value={Number.isNaN(exit.to.position[axis]) ? "" : exit.to.position[axis]}
                      onChange={(event) =>
                        change((current) =>
                          setExitTarget(current, exit.at, {
                            mapId: exit.to.mapId,
                            position: { ...exit.to.position, [axis]: event.target.valueAsNumber },
                          }),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            ))}
            <p style={{ margin: "0.25rem 0 0" }}>
              出口は片道。戻れるようにするには、行き先のマップにも出口を置く。
              行き先が立てないタイルだと、保存のときに断られる。
            </p>
          </fieldset>

          <fieldset>
            <legend>草むらに出るモンスター（重み。0 は出ない）</legend>
            {/* What is in use — and whoever turns up already, even if retired since. */}
            {offered(species, turningUp).map((kind) => (
              <label key={kind.id} style={{ display: "block" }}>
                <input
                  type="number"
                  min={0}
                  max={MAP_LIMITS.maxWeight}
                  style={{ width: "4rem" }}
                  value={form.weights[kind.id] ?? 0}
                  onChange={(event) =>
                    change((current) => setWeight(current, kind.id, event.target.valueAsNumber))
                  }
                />{" "}
                {withMark(kind.name, kind.retired)}
              </label>
            ))}
          </fieldset>

          <p>
            <button type="submit" disabled={save.kind === "saving"}>
              {save.kind === "saving" ? "保存中…" : "保存"}
            </button>{" "}
            {save.kind === "saved" && <span role="status">保存した</span>}
          </p>
          {save.kind === "failed" && (
            <p role="alert">保存できなかった（{describeError(save.error)}）</p>
          )}

          {listed !== undefined && (
            <RetireControl
              key={`${listed.id}:${listed.retired}`}
              kind="maps"
              id={listed.id}
              retired={listed.retired}
              onChanged={refresh}
            />
          )}
        </form>
      </div>
    </section>
  );
}
