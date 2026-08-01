/**
 * Player-facing SPA shell.
 *
 * Three screens are planned (docs/01-architecture.md):
 *   game     — tile map + turn-based battle
 *   settings — account / preferences, and the entry point to the skin editor
 *   editor   — the dot-art editor that produces a skin
 *
 * Nothing but the walking skeleton is wired up yet; see docs/05-roadmap.md for
 * the order the slices get built in.
 */

import { useEffect, useState } from "react";

export function App() {
  const [health, setHealth] = useState<string>("...");

  useEffect(() => {
    // Proves the Vite dev server's /api proxy reaches the Hono process.
    fetch("/api/health")
      .then((r) => r.json())
      .then((body: { status: string }) => setHealth(body.status))
      .catch((e: unknown) => setHealth(`unreachable: ${String(e)}`));
  }, []);

  return (
    <main style={{ fontFamily: "ui-monospace, monospace", padding: "2rem", lineHeight: 1.8 }}>
      <h1>Monster Battle</h1>
      <p>
        プレイヤー向け SPA の骨組み。API 疎通: <strong>{health}</strong>
      </p>
      <p>
        画面構成と実装順は <code>docs/</code> を参照。
      </p>
    </main>
  );
}
