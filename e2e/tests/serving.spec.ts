/**
 * One container, one port: both SPAs and the API (docs/01-architecture.md).
 *
 * In development these are three servers and a proxy. Whether the paths still
 * line up when a single process serves everything is exactly what cannot be
 * seen on the dev servers.
 */

import { expect, test } from "@playwright/test";

test.describe("one origin", () => {
  test("serves the player app at the root", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Monster Battle");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Monster Battle");
    // The app's own check that it can reach the API through the same origin.
    await expect(page.getByText("API 疎通:")).toContainText("ok");
  });

  for (const path of ["/admin", "/admin/"]) {
    test(`serves the admin app at ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle("Monster Battle — 管理画面");
      await expect(page.getByText("API 疎通:")).toContainText("ok");
    });
  }

  test("answers every request a page makes", async ({ page }) => {
    const failed: string[] = [];
    page.on("response", (response) => {
      // A favicon is the one thing neither app ships.
      if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
        failed.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto("/");
    await expect(page.getByRole("region", { name: "マップ" })).toBeVisible();
    await page.goto("/admin/");
    await expect(page.getByRole("region", { name: "種族" })).toBeVisible();

    expect(failed).toEqual([]);
  });

  test("serves the API beside them", async ({ request }) => {
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok" });
  });

  test("answers 404 for a path that is neither a page nor a route", async ({ request }) => {
    expect((await request.get("/api/no-such-route")).status()).toBe(404);
    expect((await request.get("/no-such-page")).status()).toBe(404);
  });
});
