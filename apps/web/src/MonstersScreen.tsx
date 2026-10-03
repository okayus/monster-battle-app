/**
 * The monsters screen: what the player owns, and what has become of it.
 *
 * Everything on it is what the server said. A monster arrives with its level
 * and its health already worked out, and there is no growth curve on this
 * side to work them out with: the screen draws the numbers it was given.
 *
 * A monster in the middle of a battle links to it. The health shown beside
 * the link is what it went in with; what it has left is the battle's to say.
 */

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { MonsterView } from "@mba/core";

import { fetchMonsters } from "./api.js";
import type { ApiError } from "./api.js";
import { describeProgress } from "./monster-text.js";
import { MonsterSprite } from "./MonsterSprite.js";
import { hrefs } from "./route.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "failed"; error: ApiError }
  | { kind: "ready"; monsters: MonsterView[] };

export function MonstersScreen() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void fetchMonsters().then((result) => {
      // The request can outlive the component (and StrictMode's first mount).
      if (cancelled) return;
      setState(
        result.ok
          ? { kind: "ready", monsters: result.value }
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
      <section aria-label="なかま">
        <p role="alert">なかまを読み込めなかった（{state.error.kind}）</p>
      </section>
    );
  }

  return (
    <section aria-label="なかま">
      <h2>なかま</h2>
      {state.monsters.length === 0 ? (
        <p>なかまは まだいない。</p>
      ) : (
        <ul style={list} aria-label="なかまの一覧">
          {state.monsters.map((monster) => (
            <li key={monster.id} style={card}>
              <Monster monster={monster} />
            </li>
          ))}
        </ul>
      )}
      <p>
        バトルに勝つと経験値が入る。減った HP は次のバトルに持ち越す。
        <br />
        負けると げんきになり、はじまりの場所に戻される。
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------

const list: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "grid",
  gap: "1rem",
};

const card: CSSProperties = { display: "flex", gap: "1rem", alignItems: "flex-start" };

const facts: CSSProperties = { display: "grid", gap: "0.25rem", justifyItems: "start" };

function Monster({ monster }: { monster: MonsterView }) {
  return (
    <>
      <MonsterSprite skinId={monster.skinId} />
      <div style={facts}>
        <span>
          <strong>{monster.name}</strong> <span data-level>Lv {monster.level}</span>
        </span>
        <progress value={monster.hp} max={monster.maxHp} aria-label={`${monster.name}の HP`} />
        <span data-hp>
          HP {monster.hp} / {monster.maxHp}
        </span>
        <span data-exp>{describeProgress(monster)}</span>
        <span>
          攻撃 {monster.attack} / 防御 {monster.defense}
        </span>
        <span>
          技: {monster.moves.map((move) => `${move.name}（威力 ${move.power}）`).join("・")}
        </span>
        {monster.battleId !== null && (
          <a href={hrefs.battle(monster.battleId)}>バトルの途中。つづきへ</a>
        )}
      </div>
    </>
  );
}
