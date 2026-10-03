import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: a real browser against the production image.
 *
 * Not the dev servers. What these tests are for is "the thing that would be
 * shipped works", and the dev servers are not that thing — the two problems
 * Step 7 found never showed up on them (docs/06-testing.md).
 */
export default defineConfig({
  testDir: "./tests",

  // There is one user, with one save, in one database, and every test talks to
  // the same server. Tests that ran side by side would move each other's
  // player, so they take turns.
  workers: 1,
  fullyParallel: false,

  // A test that passes on the second try has not passed. Fix it or delete it.
  retries: 0,
  // `test.only` left in by accident would silently skip everything else.
  forbidOnly: process.env.CI !== undefined && process.env.CI !== "",

  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    // Both SPAs and the API are one origin in production, so this is the only
    // address the tests need.
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",

    // What a failed test leaves behind, in test-results/: the page as it
    // looked, and a recording of everything up to that point. Nothing is kept
    // for a test that passes.
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
