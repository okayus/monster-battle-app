import { fileURLToPath } from "node:url";

// Only `vp test` reads this — the package itself is built by `vp pack`.
//
// Same reasoning as this package's tsconfig `paths` entry and apps/web's
// alias: resolve @mba/sprite to its source, so `pnpm test` on a clean clone
// works without building the workspace in dependency order first. Through the
// pnpm symlink it would otherwise load packages/sprite/dist, which may be
// stale or absent.
const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default {
  resolve: {
    alias: {
      "@mba/sprite": fromRoot("../sprite/src/index.ts"),
    },
  },
};
