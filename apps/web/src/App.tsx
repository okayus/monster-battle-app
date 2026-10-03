/**
 * Player-facing SPA shell.
 *
 * Three screens are planned (docs/01-architecture.md):
 *   game     — tile map + turn-based battle
 *   settings — account / preferences, and the entry point to the skin editor
 *   editor   — the dot-art editor that produces a skin
 *
 * So far only the first vertical slice is wired up: a minimal editor that
 * saves a skin, and a view that draws it back from the API. See
 * docs/05-roadmap.md for the order the rest gets built in.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";

import { SavedSkin } from "./SavedSkin.js";
import { SkinEditor } from "./SkinEditor.js";

/**
 * Which saved skin to show lives in the URL (`#/skins/<id>`), not in React
 * state. Saving a skin simply navigates to its address, and that address shows
 * the same skin after a reload — which is the evidence that it came back out
 * of the database and not out of memory.
 *
 * The pattern only admits the characters an id is made of, so whatever else
 * someone types into the address bar never reaches a request.
 */
const SKIN_HASH = /^#\/skins\/([0-9a-f-]{1,64})$/;

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function useSkinIdFromHash(): string | null {
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash);
  return SKIN_HASH.exec(hash)?.[1] ?? null;
}

const page: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  padding: "2rem",
  lineHeight: 1.8,
};

const columns: CSSProperties = { display: "flex", gap: "3rem", flexWrap: "wrap" };

export function App() {
  const [health, setHealth] = useState<string>("...");
  const skinId = useSkinIdFromHash();

  useEffect(() => {
    // Proves the Vite dev server's /api proxy reaches the Hono process.
    fetch("/api/health")
      .then((r) => r.json())
      .then((body: { status: string }) => setHealth(body.status))
      .catch((e: unknown) => setHealth(`unreachable: ${String(e)}`));
  }, []);

  return (
    <main style={page}>
      <h1>Monster Battle</h1>
      <p>
        API 疎通: <strong>{health}</strong>
      </p>
      <div style={columns}>
        <SkinEditor
          onSaved={(id) => {
            window.location.hash = `#/skins/${id}`;
          }}
        />
        {skinId !== null && <SavedSkin key={skinId} id={skinId} />}
      </div>
    </main>
  );
}
