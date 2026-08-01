/**
 * Admin SPA shell — authoring surface for master data (monsters, maps).
 *
 * Deliberately a separate app rather than a route inside the player SPA: it
 * talks to a different API prefix (/api/admin), has different authorization,
 * and must not ship its authoring code to players. See docs/01-architecture.md.
 */

import { useEffect, useState } from "react";

export function App() {
  const [health, setHealth] = useState<string>("...");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((body: { status: string }) => setHealth(body.status))
      .catch((e: unknown) => setHealth(`unreachable: ${String(e)}`));
  }, []);

  return (
    <main style={{ fontFamily: "ui-monospace, monospace", padding: "2rem", lineHeight: 1.8 }}>
      <h1>Monster Battle — 管理画面</h1>
      <p>
        マスターデータ編集用 SPA の骨組み。API 疎通: <strong>{health}</strong>
      </p>
      <p>
        追加・更新する対象と権限の方針は <code>docs/04-api-design.md</code> を参照。
      </p>
    </main>
  );
}
