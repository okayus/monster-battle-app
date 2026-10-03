/**
 * The dressing screen: which skin to wear, which parts to take from other
 * skins, and which colours to wear them in.
 *
 * What is being edited is a recipe (`Appearance`), a few dozen bytes of ids
 * and colours. Every choice is a pure function from `model.ts` applied to it,
 * and the preview is that recipe put together by `composeAppearance` — the
 * function the map uses to draw the player, and the one the server uses to
 * check what it is sent.
 *
 * Nothing here is a defence. The server validates every recipe again.
 */

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { WearableSkin } from "@mba/core";
import { PART_SLOTS, coloursOf, composeAppearance, skinsNamedBy } from "@mba/sprite";
import type { Appearance, RenderableSkin } from "@mba/sprite";

import { fetchAppearance, fetchSkins, putAppearance } from "../api.js";
import type { ApiError } from "../api.js";
import { PART_NAMES } from "../editor/names.js";
import { Playing } from "../Playing.js";
import { hrefs } from "../route.js";
import { fetchDrawings } from "./load.js";
import { colourWorn, dye, takePart, trimmed, undye, wear } from "./model.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "failed"; error: ApiError }
  | { kind: "ready"; skins: WearableSkin[]; appearance: Appearance };

/** What there is to wear, and what is worn now. Neither waits for the other. */
async function load(): Promise<LoadState> {
  const [skins, appearance] = await Promise.all([fetchSkins(), fetchAppearance()]);
  if (!skins.ok) return { kind: "failed", error: skins.error };
  if (!appearance.ok) return { kind: "failed", error: appearance.error };
  return { kind: "ready", skins: skins.value, appearance: appearance.value };
}

export function LookScreen() {
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
    return (
      <section aria-label="きがえ">
        <p role="alert">きがえを読み込めなかった（{state.error.kind}）</p>
      </section>
    );
  }
  return <Wardrobe skins={state.skins} worn={state.appearance} />;
}

// ---------------------------------------------------------------------------

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; error: ApiError };

const columns: CSSProperties = {
  display: "flex",
  gap: "2rem",
  flexWrap: "wrap",
  alignItems: "flex-start",
};
const stack: CSSProperties = { display: "grid", gap: "0.75rem", justifyItems: "start" };
const row: CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  flexWrap: "wrap",
  alignItems: "center",
};

// The <svg> has a viewBox and no size of its own, so it fills this box.
const box: CSSProperties = {
  width: "12rem",
  height: "12rem",
  border: "1px solid #888",
  background: "#ffffff",
  lineHeight: 0,
};

const recipe: CSSProperties = {
  margin: 0,
  padding: "0.5rem",
  background: "#f0f0f0",
  maxWidth: "24rem",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  lineHeight: 1.4,
};

function nameOf(skin: WearableSkin): string {
  return skin.mine ? `${skin.name}（自分で描いた）` : skin.name;
}

function Wardrobe({ skins, worn }: { skins: WearableSkin[]; worn: Appearance }) {
  const [appearance, setAppearance] = useState(worn);
  /** The skins fetched so far, by id. Only the ones a choice has named are ever asked for. */
  const [drawings, setDrawings] = useState<ReadonlyMap<string, RenderableSkin>>(new Map());
  const [drawError, setDrawError] = useState<ApiError | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  // Fetch what the recipe names and is not here yet. Keyed by the ids as a
  // string, so that choosing among skins already fetched asks for nothing.
  const missing = JSON.stringify(skinsNamedBy(appearance).filter((id) => !drawings.has(id)));
  useEffect(() => {
    const ids = JSON.parse(missing) as string[];
    if (ids.length === 0) return;

    let cancelled = false;
    void fetchDrawings(ids).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setDrawError(result.error);
        return;
      }
      setDrawError(null);
      setDrawings((have) => new Map([...have, ...result.value]));
    });
    return () => {
      cancelled = true;
    };
  }, [missing]);

  // While a part's skin is still on its way, the look is drawn with the worn
  // skin's own part in that slot. It cannot be saved until everything is here:
  // which colours it has depends on every skin in it.
  const look = composeAppearance(appearance, drawings);
  const complete = look !== undefined && missing === "[]";
  const colours = look === undefined ? [] : coloursOf(look);
  const toSend = look === undefined ? appearance : trimmed(appearance, look);

  /** Every choice goes through here: what is on screen is no longer what was saved. */
  const choose = (next: Appearance) => {
    setAppearance(next);
    setSave({ kind: "idle" });
  };

  const onSave = async () => {
    setSave({ kind: "saving" });
    const result = await putAppearance(toSend);
    setSave(result.ok ? { kind: "saved" } : { kind: "failed", error: result.error });
  };

  return (
    <section aria-label="きがえ">
      <h2>きがえ</h2>

      <div style={columns}>
        <div style={stack}>
          <div style={box} data-look>
            {look !== undefined && <Playing skin={look} colours={appearance.colours} />}
          </div>
          {drawError !== null && <p role="alert">スキンを取得できなかった（{drawError.kind}）</p>}

          <div style={row}>
            <button
              type="button"
              disabled={!complete || save.kind === "saving"}
              onClick={() => void onSave()}
            >
              {save.kind === "saving" ? "保存中…" : "この見た目にする"}
            </button>
            <span role="status">{save.kind === "saved" ? "保存した" : ""}</span>
          </div>
          {save.kind === "failed" && <p role="alert">保存できなかった（{save.error.kind}）</p>}
          <p style={{ margin: 0 }}>
            保存すると、<a href={hrefs.map}>マップ</a>の自分がこの見た目になる。
          </p>
        </div>

        <div style={stack}>
          <label>
            着るスキン{" "}
            <select
              value={appearance.skinId}
              onChange={(event) => choose(wear(appearance, event.target.value))}
            >
              {skins.map((skin) => (
                <option key={skin.id} value={skin.id}>
                  {nameOf(skin)}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend>パーツ</legend>
            <div style={stack}>
              {PART_SLOTS.map((slot) => (
                <label key={slot}>
                  {PART_NAMES[slot]}{" "}
                  <select
                    value={appearance.parts[slot] ?? ""}
                    onChange={(event) =>
                      choose(takePart(appearance, slot, event.target.value || null))
                    }
                  >
                    <option value="">着ているスキンのもの</option>
                    {skins
                      .filter((skin) => skin.id !== appearance.skinId)
                      .map((skin) => (
                        <option key={skin.id} value={skin.id}>
                          {nameOf(skin)}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </div>
            <p style={{ margin: "0.25rem 0 0" }}>
              どのスキンも同じ大きさのキャンバスに描いてあるので、どれと取り替えても位置が合う。
            </p>
          </fieldset>

          <fieldset>
            <legend>色</legend>
            <div style={row}>
              {colours.map((entry) => (
                <label key={entry.id}>
                  {entry.id}{" "}
                  <input
                    type="color"
                    aria-label={`${entry.id} の色`}
                    value={colourWorn(appearance.colours, entry.id) ?? entry.hex}
                    onChange={(event) => choose(dye(appearance, entry.id, event.target.value))}
                  />
                </label>
              ))}
              <button
                type="button"
                disabled={appearance.colours.length === 0}
                onClick={() => choose(undye(appearance))}
              >
                描いた色に戻す
              </button>
            </div>
            <p style={{ margin: "0.25rem 0 0" }}>
              色は名前で決まる。hair を変えると、どのスキンのパーツでも hair
              で塗ったところが変わる。
            </p>
          </fieldset>

          <div>
            <p style={{ margin: 0 }}>
              <code>PUT /api/appearance</code> に送るのはこれだけ。絵は送らない。
            </p>
            <pre style={recipe} data-recipe>
              {JSON.stringify(toSend)}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
