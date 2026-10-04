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

import { useState } from "react";
import type { CSSProperties } from "react";

import { ok } from "@mba/core";
import type { MonsterView, Result } from "@mba/core";

import { fetchMonsters, fetchSkin } from "./api.js";
import type { ApiError } from "./api.js";
import { Loaded } from "./loaded.js";
import { describeProgress } from "./monster-text.js";
import { MonsterSprite } from "./MonsterSprite.js";
import type { Picture } from "./MonsterSprite.js";
import { hrefs } from "./route.js";

/** A monster, and its picture on the way. */
interface Owned {
  monster: MonsterView;
  picture: Picture;
}

async function load(): Promise<Result<Owned[], ApiError>> {
  const monsters = await fetchMonsters();
  if (!monsters.ok) return monsters;
  // The pictures are asked for here, as soon as it is known which skins they
  // are, and not by the sprites that will show them.
  return ok(monsters.value.map((monster) => ({ monster, picture: fetchSkin(monster.skinId) })));
}

export function MonstersScreen() {
  const [loading] = useState(load);

  return (
    <Loaded
      from={loading}
      waiting={<p>読み込み中…</p>}
      failed={(error) => (
        <section aria-label="なかま">
          <p role="alert">なかまを読み込めなかった（{error.kind}）</p>
        </section>
      )}
    >
      {(owned) => <Monsters owned={owned} />}
    </Loaded>
  );
}

function Monsters({ owned }: { owned: Owned[] }) {
  return (
    <section aria-label="なかま">
      <h2>なかま</h2>
      {owned.length === 0 ? (
        <p>なかまは まだいない。</p>
      ) : (
        <ul style={list} aria-label="なかまの一覧">
          {owned.map(({ monster, picture }) => (
            <li key={monster.id} style={card}>
              <Monster monster={monster} picture={picture} />
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

function Monster({ monster, picture }: { monster: MonsterView; picture: Picture }) {
  return (
    <>
      <MonsterSprite picture={picture} />
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
