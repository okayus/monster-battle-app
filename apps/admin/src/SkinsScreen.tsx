/**
 * Skins: every one there is, to retire or bring back.
 *
 * There is no form here. A skin is drawn in the player app's editor and saved
 * through the game API, and it is never edited afterwards. What an admin can
 * do to one is take it out of use — which is the only handle there is on a
 * drawing a player made.
 */

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { SkinSummary } from "@mba/core";

import { describeError, fetchSkins } from "./api.js";
import type { ApiError } from "./api.js";
import { withMark } from "./retire.js";
import { RetireControl } from "./RetireControl.js";
import { SkinPreview } from "./SkinPreview.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "failed"; error: ApiError }
  | { kind: "ready"; skins: SkinSummary[] };

const list: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "grid",
  gap: "1rem",
};

function item(retired: boolean): CSSProperties {
  return { display: "flex", gap: "1rem", alignItems: "center", opacity: retired ? 0.55 : 1 };
}

export function SkinsScreen() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = async () => {
    const result = await fetchSkins();
    setState(
      result.ok ? { kind: "ready", skins: result.value } : { kind: "failed", error: result.error },
    );
  };

  useEffect(() => {
    let cancelled = false;
    void fetchSkins().then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { kind: "ready", skins: result.value }
          : { kind: "failed", error: result.error },
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
          : `スキンを読み込めなかった（${describeError(state.error)}）`}
      </p>
    );
  }

  return (
    <section aria-label="スキン">
      <h2>スキン</h2>
      <p>スキンはプレイヤー側のエディタで描く。ここでできるのは、retire することと戻すこと。</p>
      <p>
        retire
        しても消えない。きがえにも種族の見た目にも出なくなり、着ていたプレイヤーは最初のスキンに戻る。
        戻せば、元の見た目に戻る。
      </p>
      <ul style={list} aria-label="スキンの一覧">
        {state.skins.map((skin) => (
          <li key={skin.id} style={item(skin.retired)}>
            <SkinPreview skinId={skin.id} size="4rem" />
            <div>
              <strong>{withMark(skin.name, skin.retired)}</strong>（
              {skin.ownerId === null ? "運営" : "プレイヤー作"}）
              <RetireControl
                key={`${skin.id}:${skin.retired}`}
                kind="skins"
                id={skin.id}
                retired={skin.retired}
                onChanged={load}
                quiet
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
