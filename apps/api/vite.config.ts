import { fileURLToPath } from "node:url";

// Only `vp test` reads this — the app itself is built by `vp pack`.
//
// Same reasoning as this app's tsconfig `paths`: resolve the workspace
// packages to their source, so `pnpm test` on a clean clone works without
// building the workspace in dependency order first. Through the pnpm symlinks
// they would otherwise load packages/*/dist, which may be stale or absent.
//
// It also matters for @mba/db in particular: `runMigrations` finds the
// migration files relative to its own module, and from source that resolves to
// packages/db/drizzle — the real, committed migrations. The tests therefore
// run against the same SQL a fresh database gets.
const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default {
  resolve: {
    alias: {
      "@mba/core": fromRoot("../../packages/core/src/index.ts"),
      "@mba/db": fromRoot("../../packages/db/src/index.ts"),
      "@mba/sprite": fromRoot("../../packages/sprite/src/index.ts"),
    },
  },
};
