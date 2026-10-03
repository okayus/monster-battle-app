# The browser side of the end-to-end tests: Playwright, Chromium, and the tests.
#
# Built from this directory alone (see docker-compose.e2e.yml). It shares
# nothing with the app's images on purpose: the test tooling is not in the
# app's dependency graph, and the dev image does not have to carry a browser.

FROM node:24
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack install --global pnpm@11.18.0
WORKDIR /e2e

# Dependencies first, from the manifest and lockfile only: this layer and the
# browser download below are reused until one of those two files changes, so
# editing a test does not fetch Chromium again.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Chromium, and the system libraries it links against. Which build gets
# downloaded is decided by the Playwright version in the lockfile, so the
# browser and the library that drives it cannot drift apart.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pnpm exec playwright install --with-deps --only-shell chromium

COPY . .

# The tests are code too. A type error, a lint warning or an unformatted file
# fails this build, the same way `docker build --target check .` does for the
# app.
RUN pnpm run typecheck && pnpm run lint && pnpm run fmt:check

# Not root, like the other images. The directory has to be writable because
# Playwright keeps its results next to the tests.
RUN chown -R node:node /e2e
USER node

CMD ["pnpm", "exec", "playwright", "test"]
