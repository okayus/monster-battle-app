/**
 * The battle screen.
 *
 * It decides one thing: which move to use. Everything else it shows — health,
 * what each hit did, who won — is what the server said. There is no damage
 * formula on this side and no check for "has someone fainted"; the screen
 * draws the state it was last given and waits to be given the next one.
 */

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { BattleView, CombatantView } from "@mba/core";
import type { RenderableSkin } from "@mba/sprite";
import { Sprite } from "@mba/sprite-react";

import { fetchBattle, fetchSkin, playTurn } from "./api.js";
import type { ApiError } from "./api.js";
import { describeEvent } from "./battle-log.js";
import { hrefs } from "./route.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "failed"; error: ApiError }
  | { kind: "ready"; battle: BattleView };

/**
 * The caller keys this component by `id`, so a different battle is a fresh
 * mount that starts out "loading".
 */
export function BattleScreen({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void fetchBattle(id).then((result) => {
      // The request can outlive the component (and StrictMode's first mount).
      if (cancelled) return;
      setState(
        result.ok
          ? { kind: "ready", battle: result.value }
          : { kind: "failed", error: result.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.kind === "loading") return <p>読み込み中…</p>;
  if (state.kind === "failed") {
    return (
      <section aria-label="バトル">
        <p role="alert">バトルを読み込めなかった（{state.error.kind}）</p>
        <a href={hrefs.map}>マップに戻る</a>
      </section>
    );
  }
  return <Battle initial={state.battle} />;
}

// ---------------------------------------------------------------------------

const field: CSSProperties = { display: "flex", gap: "3rem", flexWrap: "wrap" };

const card: CSSProperties = { display: "grid", gap: "0.25rem", justifyItems: "start" };

// The <svg> has a viewBox and no size of its own, so it fills this box.
const spriteBox: CSSProperties = {
  width: "8rem",
  height: "8rem",
  border: "1px solid #888",
  lineHeight: 0,
};

const row: CSSProperties = { display: "flex", gap: "0.5rem", margin: "0.75rem 0" };

/**
 * A monster's picture, fetched like any other skin. If it cannot be fetched
 * the box stays empty and the battle goes on: a missing picture is not worth
 * stopping a fight for.
 */
function MonsterSprite({ skinId }: { skinId: string }) {
  const [skin, setSkin] = useState<RenderableSkin | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSkin(skinId).then((result) => {
      if (!cancelled && result.ok) setSkin(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, [skinId]);

  return <div style={spriteBox}>{skin !== null && <Sprite skin={skin} />}</div>;
}

function Fighter({
  label,
  name,
  fighter,
}: {
  label: string;
  name: string;
  fighter: CombatantView;
}) {
  return (
    <div style={card} role="group" aria-label={label}>
      <strong>{name}</strong>
      <MonsterSprite skinId={fighter.skinId} />
      <progress value={fighter.hp} max={fighter.maxHp} aria-label={`${label}の HP`} />
      <span>
        HP {fighter.hp} / {fighter.maxHp}
      </span>
    </div>
  );
}

function Battle({ initial }: { initial: BattleView }) {
  const [battle, setBattle] = useState(initial);
  /** This visit's turns, as text. Not stored anywhere: a reload starts it empty. */
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // A wild monster can be the same species as the player's, and then the log
  // would read as one monster hitting itself.
  const names = { player: battle.player.name, enemy: `やせいの ${battle.enemy.name}` };

  const play = async (moveId: string) => {
    setBusy(true);
    setError(null);
    const result = await playTurn(battle.id, moveId, battle.turn);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      // The server is on a different turn than this screen thinks — another
      // tab played, or a request went through twice. Its version is the truth.
      if (result.error.kind === "stale_turn") {
        const fresh = await fetchBattle(battle.id);
        if (fresh.ok) setBattle(fresh.value);
      }
      return;
    }

    setBattle(result.value.battle);
    setLog((lines) => [
      ...lines,
      ...result.value.events.map((event) => describeEvent(event, names)),
    ]);
  };

  return (
    <section aria-label="バトル">
      <h2>バトル</h2>

      <div style={field}>
        <Fighter label="こちら" name={names.player} fighter={battle.player} />
        <Fighter label="あいて" name={names.enemy} fighter={battle.enemy} />
      </div>

      {battle.status === "ongoing" ? (
        <div style={row} role="group" aria-label="技">
          {battle.player.moves.map((move) => (
            <button key={move.id} type="button" disabled={busy} onClick={() => void play(move.id)}>
              {move.name}（威力 {move.power}）
            </button>
          ))}
        </div>
      ) : (
        <p>
          <strong role="status">{battle.status === "won" ? "勝った！" : "負けてしまった…"}</strong>{" "}
          <a href={hrefs.map}>マップに戻る</a>
        </p>
      )}

      {error !== null && <p role="alert">技を出せなかった（{error.kind}）</p>}

      <ol aria-label="ログ">
        {/* Lines are only ever appended, so a line's position is a stable key. */}
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
    </section>
  );
}
