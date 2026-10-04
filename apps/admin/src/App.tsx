/**
 * Admin SPA shell — authoring surface for master data (monsters, moves, maps),
 * and the place where things are retired.
 *
 * Deliberately a separate app rather than a route inside the player SPA: it
 * talks to a different API prefix (/api/admin), has different authorization,
 * and must not ship its authoring code to players. See docs/01-architecture.md.
 */

import { useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";

import { useSettled } from "./loaded.js";
import { MapsScreen } from "./MapsScreen.js";
import { MovesScreen } from "./MovesScreen.js";
import { hrefs, parseRoute } from "./route.js";
import type { Route } from "./route.js";
import { SkinsScreen } from "./SkinsScreen.js";
import { SpeciesScreen } from "./SpeciesScreen.js";

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** The current screen, read from the URL (see route.ts). */
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

const page: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  padding: "2rem",
  lineHeight: 1.8,
};

const nav: CSSProperties = { display: "flex", gap: "1.5rem" };

export function App() {
  const [checking] = useState(checkHealth);
  const health = useSettled(checking) ?? "...";
  const route = useRoute();

  return (
    <main style={page}>
      <h1>Monster Battle — 管理画面</h1>
      <nav style={nav} aria-label="画面">
        <a href={hrefs.species} aria-current={route.screen === "species" ? "page" : undefined}>
          種族
        </a>
        <a href={hrefs.moves} aria-current={route.screen === "moves" ? "page" : undefined}>
          技
        </a>
        <a href={hrefs.maps} aria-current={route.screen === "maps" ? "page" : undefined}>
          マップ
        </a>
        <a href={hrefs.skins} aria-current={route.screen === "skins" ? "page" : undefined}>
          スキン
        </a>
      </nav>
      <p>
        API 疎通: <strong>{health}</strong>
      </p>

      {route.screen === "species" && <SpeciesScreen />}
      {route.screen === "moves" && <MovesScreen />}
      {route.screen === "maps" && <MapsScreen />}
      {route.screen === "skins" && <SkinsScreen />}
    </main>
  );
}
