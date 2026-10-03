/**
 * Walking, and where the player is after coming back.
 *
 * The starter map, for reading the coordinates below (x across, y down):
 *
 *        0123456789012345
 *      0 TTTTTTTTTTTTTTTT      T tree   w water
 *      1 T@...gggg..wwwwT      . path   g grass
 *      2 T.TT.gggg..wwwwT      @ where a new game starts
 *      3 T.TT.......wwwwT
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { failOnPageErrors, standAt, storedPosition } from "./helpers.js";
import type { Position } from "./helpers.js";

function map(page: Page) {
  return page.getByRole("region", { name: "マップ" });
}

/** Waits until the screen shows the player at a position. */
async function expectAt(page: Page, x: number, y: number): Promise<void> {
  await expect(map(page).getByText("現在地:")).toContainText(`(${x}, ${y})`);
  // The text and the marker are drawn from the same state; this checks that
  // the marker really is on that tile and not merely that the text says so.
  const marker = await map(page)
    .locator("[data-tile]")
    .evaluateAll((tiles) => tiles.findIndex((tile) => tile.querySelector("[data-player]")));
  expect([marker % 16, Math.floor(marker / 16)]).toEqual([x, y]);
}

async function expectSaved(page: Page): Promise<void> {
  await expect(map(page).getByRole("status")).toHaveText("保存済み");
}

test.describe("the map", () => {
  test.beforeEach(async ({ page, request }) => {
    failOnPageErrors(page);
    await standAt(request, 2, 1);
    await page.goto("/");
    await expectAt(page, 2, 1);
  });

  test("draws every tile of the map", async ({ page }) => {
    await expect(map(page).getByRole("heading")).toHaveText("はじまりの草原");
    await expect(map(page).locator("[data-tile]")).toHaveCount(16 * 12);
    for (const kind of ["path", "grass", "tree", "water"]) {
      expect(await map(page).locator(`[data-tile="${kind}"]`).count()).toBeGreaterThan(0);
    }
  });

  test("walks with the arrow keys", async ({ page }) => {
    await page.keyboard.press("ArrowRight");
    await expectAt(page, 3, 1);
    await page.keyboard.press("ArrowRight");
    await expectAt(page, 4, 1);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expectAt(page, 4, 3);
    await page.keyboard.press("ArrowUp");
    await expectAt(page, 4, 2);
    await page.keyboard.press("ArrowLeft");
    // (3,2) is a tree.
    await expectAt(page, 4, 2);
  });

  test("walks with WASD and with the buttons on screen", async ({ page }) => {
    await page.keyboard.press("d");
    await page.keyboard.press("d");
    await expectAt(page, 4, 1);
    await page.keyboard.press("s");
    await expectAt(page, 4, 2);
    await page.keyboard.press("w");
    await page.keyboard.press("a");
    await expectAt(page, 3, 1);

    const buttons = map(page).getByRole("group", { name: "移動" });
    await buttons.getByRole("button", { name: "右へ" }).click();
    await buttons.getByRole("button", { name: "下へ" }).click();
    await expectAt(page, 4, 2);
    await buttons.getByRole("button", { name: "上へ" }).click();
    await buttons.getByRole("button", { name: "左へ" }).click();
    await expectAt(page, 3, 1);
  });

  test("is stopped by trees and by water", async ({ page, request }) => {
    await page.keyboard.press("ArrowRight"); // (3,1)
    await page.keyboard.press("ArrowDown"); // (3,2) is a tree
    await expectAt(page, 3, 1);
    await page.keyboard.press("ArrowUp"); // (3,0) is the tree border
    await expectAt(page, 3, 1);

    await standAt(request, 10, 3);
    await page.reload();
    await expectAt(page, 10, 3);
    await page.keyboard.press("ArrowRight"); // (11,3) is water
    await expectAt(page, 10, 3);
  });

  test("saves each step, and starts from there after a reload", async ({ page, request }) => {
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await expectAt(page, 4, 2);
    await expectSaved(page);
    expect(await storedPosition(request)).toEqual({ x: 4, y: 2 });

    await page.reload();
    await expectAt(page, 4, 2);
    // Arriving is not moving: loading the position must not save it again.
    await expect(map(page).getByRole("status")).toHaveText("");
  });

  test("keeps the last position of a burst of steps", async ({ page, request }) => {
    // The first save is held back until every step has been taken, so the rest
    // of the burst happens while a request is on its way. What has to happen
    // then is in saver.ts: nothing else goes out until that request returns,
    // and after it only the newest position does.
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: Position[] = [];
    await page.route("**/api/save", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      const { position } = route.request().postDataJSON() as { position: Position };
      sent.push(position);
      if (sent.length === 1) await held;
      await route.continue();
    });

    for (const key of [
      "ArrowRight",
      "ArrowRight",
      "ArrowDown",
      "ArrowDown",
      "ArrowUp",
      "ArrowDown",
    ]) {
      await page.keyboard.press(key);
    }
    await expectAt(page, 4, 3);
    await expect(map(page).getByRole("status")).toHaveText("保存中…");
    await expect.poll(() => sent).toEqual([{ x: 3, y: 1 }]);

    release();
    await expectSaved(page);
    // The four places in between were never sent. Had each step gone out on
    // its own, they would all have landed before the one that was held, and
    // the first step would be what is stored.
    expect(sent).toEqual([
      { x: 3, y: 1 },
      { x: 4, y: 3 },
    ]);
    expect(await storedPosition(request)).toEqual({ x: 4, y: 3 });
  });

  test("shows a save that failed, keeps walking, and saves again later", async ({
    page,
    context,
    request,
  }) => {
    await context.setOffline(true);
    await page.keyboard.press("ArrowRight");
    // Walking never waits for the network, so the step still happens.
    await expectAt(page, 3, 1);
    await expect(map(page).getByRole("status")).toHaveText("保存できなかった（network）");
    expect(await storedPosition(request)).toEqual({ x: 2, y: 1 });

    await context.setOffline(false);
    await page.keyboard.press("ArrowRight");
    await expectAt(page, 4, 1);
    await expectSaved(page);
    expect(await storedPosition(request)).toEqual({ x: 4, y: 1 });
  });

  test("does not scroll the page with the arrow keys", async ({ page }) => {
    // Short enough that the page is taller than the window.
    await page.setViewportSize({ width: 900, height: 360 });
    const scrolled = () => page.evaluate(() => window.scrollY);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight),
    ).toBe(true);

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await expectAt(page, 4, 2);
    // Scrolling by key is animated. Straight after the press the page is still
    // at 0 whether or not it is about to move, so looking at once would pass
    // no matter what. A scroll that is coming has started well within this.
    await page.waitForTimeout(500);
    expect(await scrolled()).toBe(0);

    // A key the map has no use for keeps its meaning — which also shows that
    // "it did not scroll" above was the map's doing, and not a page that keys
    // cannot scroll in the first place.
    await page.keyboard.press("PageDown");
    await expect.poll(scrolled).toBeGreaterThan(0);
  });
});
