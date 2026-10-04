/**
 * Shows a saved skin, drawn from what the API returns for its id — not from
 * anything the editor still has in memory. That is what makes this the far end
 * of the vertical slice: if these pixels appear, the skin went through the
 * validator, into SQLite, and back out.
 */

import { useState } from "react";
import type { CSSProperties } from "react";

import type { Skin } from "@mba/sprite";

import { fetchSkin, fetchSkinSource } from "./api.js";
import type { ApiError } from "./api.js";
import { Loaded } from "./loaded.js";
import { Playing } from "./Playing.js";
import { hrefs } from "./route.js";

// The <svg> has a viewBox and no size of its own, so it fills this box.
const frame: CSSProperties = { width: "12rem", border: "1px solid #888", lineHeight: 0 };

/**
 * The caller keys this component by `id`, so a different id is a fresh mount
 * with a request of its own — there is never a stale skin to clear first.
 */
export function SavedSkin({ id, onOpen }: { id: string; onOpen: (skin: Skin) => void }) {
  const [drawing] = useState(() => fetchSkin(id));
  const [openError, setOpenError] = useState<ApiError | null>(null);

  const open = async () => {
    setOpenError(null);
    // The editable form is a separate request, made only now. Drawing never
    // needs it: what is on screen came from the render-ready form.
    const source = await fetchSkinSource(id);
    if (!source.ok) {
      setOpenError(source.error);
      return;
    }
    onOpen(source.value);
  };

  return (
    <section aria-label="保存されたスキン">
      <h2>保存されたスキン</h2>
      <p>
        <code>GET /api/skins/{id}</code> の応答を描いている。
      </p>
      <Loaded
        from={drawing}
        waiting={<p>読み込み中…</p>}
        failed={(error) => <p role="alert">取得できなかった（{error.kind}）</p>}
      >
        {(skin) => (
          <>
            <div style={frame}>
              <Playing skin={skin} />
            </div>
            <p>
              <button type="button" onClick={() => void open()}>
                このスキンをエディタで開く
              </button>
            </p>
            <p>開くと、いまエディタにある絵は置きかわる。保存すると新しいスキンになる。</p>
            <p>
              このスキンは<a href={hrefs.look}>きがえ</a>で着られる。
            </p>
          </>
        )}
      </Loaded>
      {openError !== null && <p role="alert">開けなかった（{openError.kind}）</p>}
    </section>
  );
}
