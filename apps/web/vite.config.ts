import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Not wrapped in vite-plus's `defineConfig`: @vitejs/plugin-react's `Plugin`
// type comes from the real `vite` package, while vite-plus types against its
// own fork — two nominally distinct copies of the same shape that the type
// checker cannot reconcile. `vp dev` / `vp build` load this file at runtime
// exactly like Vite does, so a plain default-exported object works the same.
const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default {
  plugins: [react()],
  resolve: {
    alias: {
      // Bundle the workspace packages straight from source: no prebuild step,
      // and edits to packages/*/src show up instantly under HMR.
      "@mba/core": fromRoot("../../packages/core/src/index.ts"),
      "@mba/sprite": fromRoot("../../packages/sprite/src/index.ts"),
      "@mba/sprite-react": fromRoot("../../packages/sprite-react/src/index.tsx"),
    },
  },
  server: {
    host: true, // 0.0.0.0 — reachable from the host through the compose port map
    port: 5173,
    strictPort: true,
    // The browser only ever talks to this origin; Vite relays /api to the Hono
    // dev server, so there is no cross-origin request and no CORS middleware.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
};
