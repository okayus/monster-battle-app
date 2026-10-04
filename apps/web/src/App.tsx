/**
 * Player-facing SPA shell.
 *
 * Three screens are planned (docs/01-architecture.md):
 *   game     — tile map + turn-based battle
 *   settings — account / preferences, and the entry point to the skin editor
 *   editor   — the dot-art editor that produces a skin
 *
 * Five slices are wired up so far: the map you can walk on, battles against
 * what lives in the grass, the monsters you own, the skin editor, and
 * choosing what to wear. See docs/05-roadmap.md for the order they were
 * built in.
 */

import { Suspense, use, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";

import { BattleScreen } from "./battle/BattleScreen.js";
import { fromSkin, newEditor } from "./editor/model.js";
import { SkinEditor } from "./editor/SkinEditor.js";
import { LookScreen } from "./look/LookScreen.js";
import { MapScreen } from "./map/MapScreen.js";
import { MonstersScreen } from "./MonstersScreen.js";
import { hrefs, parseRoute } from "./route.js";
import type { Route } from "./route.js";
import { SavedSkin } from "./SavedSkin.js";

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * The current screen, read from the URL (see route.ts). Subscribing to the
 * hash rather than copying it into state means the address bar and the screen
 * cannot disagree.
 */
function useRoute(): Route {
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash);
  return parseRoute(hash);
}

/**
 * Proves the Vite dev server's /api proxy reaches the Hono process. Like the
 * calls in api.ts it never rejects: not reaching the API is something to
 * show, so it is a value.
 */
function checkHealth(): Promise<string> {
  return fetch("/api/health")
    .then((r) => r.json())
    .then((body: { status: string }) => body.status)
    .catch((e: unknown) => `unreachable: ${String(e)}`);
}

function Health({ from }: { from: Promise<string> }) {
  return <strong>{use(from)}</strong>;
}

const page: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  padding: "2rem",
  lineHeight: 1.8,
};

const nav: CSSProperties = { display: "flex", gap: "1.5rem" };

const columns: CSSProperties = { display: "flex", gap: "3rem", flexWrap: "wrap" };

export function App() {
  const [health] = useState(checkHealth);
  const route = useRoute();
  // The drawing in progress is kept up here, above the screens, so that a look
  // at the map does not throw it away. It does not survive a reload.
  const [editor, setEditor] = useState(newEditor);

  return (
    <main style={page}>
      <h1>Monster Battle</h1>
      <nav style={nav} aria-label="画面">
        <a href={hrefs.map} aria-current={route.screen === "map" ? "page" : undefined}>
          マップ
        </a>
        <a href={hrefs.monsters} aria-current={route.screen === "monsters" ? "page" : undefined}>
          なかま
        </a>
        <a href={hrefs.look} aria-current={route.screen === "look" ? "page" : undefined}>
          きがえ
        </a>
        <a href={hrefs.editor} aria-current={route.screen === "editor" ? "page" : undefined}>
          スキンエディタ
        </a>
      </nav>
      <p>
        API 疎通:{" "}
        <Suspense fallback={<strong>...</strong>}>
          <Health from={health} />
        </Suspense>
      </p>

      {route.screen === "map" && <MapScreen />}

      {route.screen === "battle" && <BattleScreen key={route.battleId} id={route.battleId} />}

      {route.screen === "monsters" && <MonstersScreen />}

      {route.screen === "look" && <LookScreen />}

      {route.screen === "editor" && (
        <div style={columns}>
          <SkinEditor
            state={editor}
            onChange={setEditor}
            onSaved={(id) => {
              // Saving a skin navigates to its address. That address shows the
              // same skin after a reload, which is the evidence that it came
              // back out of the database and not out of memory.
              window.location.hash = hrefs.skin(id);
            }}
          />
          {route.skinId !== null && (
            <SavedSkin
              key={route.skinId}
              id={route.skinId}
              onOpen={(skin) => setEditor(fromSkin(skin))}
            />
          )}
        </div>
      )}
    </main>
  );
}
