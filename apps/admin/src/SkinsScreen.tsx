/**
 * Skins: every one there is, to retire or bring back.
 *
 * There is no form here. A skin is drawn in the player app's editor and saved
 * through the game API, and it is never edited afterwards. What an admin can
 * do to one is take it out of use — which is the only handle there is on a
 * drawing a player made.
 */

import { useState } from "react";
import type { CSSProperties } from "react";

import type { SkinSummary } from "@mba/core";

import { fetchSkins } from "./api.js";
import { Loaded, couldNotLoad, remember } from "./loaded.js";
import { withMark } from "./retire.js";
import { RetireControl } from "./RetireControl.js";
import { SkinPreview } from "./SkinPreview.js";

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
  const [listing, setListing] = useState(fetchSkins);

  // After a retire or a restore the list is asked for again: it is the
  // server's, in the server's order. The new one takes the screen only once
  // it is in, so the list that is up stays up until then.
  const refresh = async () => {
    const next = remember(fetchSkins());
    await next;
    setListing(next);
  };

  return (
    <Loaded from={listing} waiting={<p>読み込み中…</p>} failed={couldNotLoad("スキン")}>
      {(skins) => <SkinList skins={skins} onChanged={refresh} />}
    </Loaded>
  );
}

function SkinList({ skins, onChanged }: { skins: SkinSummary[]; onChanged: () => Promise<void> }) {
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
        {skins.map((skin) => (
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
                onChanged={onChanged}
                quiet
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
