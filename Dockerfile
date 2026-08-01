# monster-battle-app — multi-stage build.
#
#   docker compose up                       -> "dev" stage: bind-mounted source,
#                                              hot reload for all three surfaces
#   docker build --target prod -t <tag> .    -> "prod" stage: one container that
#                                              serves the API + both SPAs
#
# See README.md for the full dev/prod workflow.

FROM node:24 AS base
# Bake the exact pnpm from package.json's `packageManager` into the image.
# `corepack enable` alone only shims the binary: the first pnpm invocation then
# downloads it, and with a TTY attached (docker-compose sets `tty: true`) that
# download asks for confirmation and blocks container startup forever.
# COREPACK_ENABLE_DOWNLOAD_PROMPT=0 also covers any later version bump.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack install --global pnpm@11.18.0
# better-sqlite3 compiles a native addon at install time, and esbuild (used
# internally by vite/vite-plus/tsx/vitest) runs a native postinstall too.
# Both need a C++ toolchain, which the plain node:24 image doesn't include.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- dev -------------------------------------------------------------------
# docker-compose bind-mounts the repo over /app; `pnpm install` and the dev
# servers run as the compose service's `command`, not baked into the image.
FROM base AS dev
EXPOSE 3000 5173 5174

# ---- builder (intermediate only, not a compose target) ---------------------
FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile
# pnpm's recursive commands run in workspace-dependency order, so the packages
# build before the apps that consume them.
RUN pnpm -r run build

# ---- prod ------------------------------------------------------------------
# One container serving the API and both built SPAs on a single port. Same base
# image as `builder` so better-sqlite3's compiled native addon stays compatible.
FROM base AS prod
ENV NODE_ENV=production
COPY --from=builder /app /app
EXPOSE 3000
CMD ["node", "apps/api/dist/index.mjs"]
