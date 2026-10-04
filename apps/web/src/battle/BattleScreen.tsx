/**
 * The battle screen.
 *
 * It decides one thing: which move to use. Everything else it shows — health,
 * what each hit did, who won, what the win was worth — is what the server
 * said. There is no damage formula on this side, no check for "has someone
 * fainted" and no sum of experience; the screen draws the state it was last
 * given and waits to be given the next one.
 *
 * What a battle leaves behind is not written from here either. By the time
 * this screen says "won", the monster already has its experience; by the time
 * it says "lost", the player has already been put back at the start. The
 * screen only says so.
 */

import { useReducer, useState } from "react";
import type { CSSProperties } from "react";

import { ok } from "@mba/core";
import type { BattleView, CombatantView, Result, Side } from "@mba/core";

import { fetchBattle, fetchSkin, playTurn } from "../api.js";
import type { ApiError } from "../api.js";
import { Loaded } from "../loaded.js";
import { MonsterSprite } from "../MonsterSprite.js";
import type { Picture } from "../MonsterSprite.js";
import { hrefs } from "../route.js";
import { fight, isBehind, isGoingOn, namesOf, opened } from "./model.js";

/** What opening a battle asks the server for. */
interface Opening {
  battle: BattleView;
  /** Each side's picture, asked for as soon as it is known which skin it wears. */
  pictures: Record<Side, Picture>;
}

async function open(id: string): Promise<Result<Opening, ApiError>> {
  const battle = await fetchBattle(id);
  if (!battle.ok) return battle;
  const { player, enemy } = battle.value;
  // Started here and not by the two sprites: both at once, the moment it is
  // known whose they are.
  const pictures = { player: fetchSkin(player.skinId), enemy: fetchSkin(enemy.skinId) };
  return ok({ battle: battle.value, pictures });
}

/**
 * The caller keys this component by `id`, so a different battle is a fresh
 * mount with a request of its own.
 */
export function BattleScreen({ id }: { id: string }) {
  const [opening] = useState(() => open(id));

  return (
    <Loaded
      from={opening}
      waiting={<p>読み込み中…</p>}
      failed={(error) => (
        <section aria-label="バトル">
          <p role="alert">バトルを読み込めなかった（{error.kind}）</p>
          <a href={hrefs.map}>マップに戻る</a>
        </section>
      )}
    >
      {({ battle, pictures }) => <Battle initial={battle} pictures={pictures} />}
    </Loaded>
  );
}

// ---------------------------------------------------------------------------

const field: CSSProperties = { display: "flex", gap: "3rem", flexWrap: "wrap" };

const card: CSSProperties = { display: "grid", gap: "0.25rem", justifyItems: "start" };

const row: CSSProperties = { display: "flex", gap: "0.5rem", margin: "0.75rem 0" };

function Fighter({
  label,
  name,
  fighter,
  picture,
}: {
  label: string;
  name: string;
  fighter: CombatantView;
  picture: Picture;
}) {
  return (
    <div style={card} role="group" aria-label={label}>
      <span>
        <strong>{name}</strong> <span data-level>Lv {fighter.level}</span>
      </span>
      <MonsterSprite picture={picture} />
      <progress value={fighter.hp} max={fighter.maxHp} aria-label={`${label}の HP`} />
      <span>
        HP {fighter.hp} / {fighter.maxHp}
      </span>
    </div>
  );
}

function Battle({ initial, pictures }: { initial: BattleView; pictures: Record<Side, Picture> }) {
  const [state, dispatch] = useReducer(fight, opened(initial));
  const { battle } = state;
  const names = namesOf(battle);

  const play = async (moveId: string) => {
    dispatch({ kind: "move_sent" });
    const result = await playTurn(battle.id, moveId, battle.turn);
    if (result.ok) {
      dispatch({ kind: "turn_played", outcome: result.value });
      return;
    }

    dispatch({ kind: "turn_refused", error: result.error });
    // The server is on a different turn than this screen thinks. Its version
    // is the truth.
    if (isBehind(result.error)) {
      const fresh = await fetchBattle(battle.id);
      if (fresh.ok) dispatch({ kind: "caught_up", battle: fresh.value });
    }
  };

  return (
    <section aria-label="バトル">
      <h2>バトル</h2>

      <div style={field}>
        <Fighter
          label="こちら"
          name={names.player}
          fighter={battle.player}
          picture={pictures.player}
        />
        <Fighter
          label="あいて"
          name={names.enemy}
          fighter={battle.enemy}
          picture={pictures.enemy}
        />
      </div>

      {isGoingOn(state) ? (
        <div style={row} role="group" aria-label="技">
          {battle.player.moves.map((move) => (
            <button
              key={move.id}
              type="button"
              disabled={state.waiting}
              onClick={() => void play(move.id)}
            >
              {move.name}（威力 {move.power}）
            </button>
          ))}
        </div>
      ) : (
        <>
          <p>
            <strong role="status">
              {battle.status === "won" ? "勝った！" : "負けてしまった…"}
            </strong>{" "}
            <a href={hrefs.map}>マップに戻る</a>
          </p>
          {/* What the server has already done. Nothing here makes it happen. */}
          <p data-aftermath>
            {battle.status === "won"
              ? "減った HP は、次のバトルに持ち越す。"
              : `${names.player} は げんきになり、はじまりの場所に戻された。`}
          </p>
        </>
      )}

      {state.refused !== null && <p role="alert">技を出せなかった（{state.refused.kind}）</p>}

      <ol aria-label="ログ">
        {/* Lines are only ever appended, so a line's position is a stable key. */}
        {state.log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
    </section>
  );
}
