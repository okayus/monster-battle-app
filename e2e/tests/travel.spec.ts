/**
 * Going from one map to another, through an exit.
 *
 * The door these tests use is on the starter map, one step below where a new
 * game starts, and it is only there while one of them runs:
 *
 *        0123
 *      0 TTTT
 *      1 T@..      @ (1,1) where each test stands the player
 *      2 T>TT      > (1,2) the door
 *
 * It leads to a pond each test makes for itself:
 *
 *        012
 *      0 .gw       (0,0) path   (1,0) grass   (2,0) water
 *      1 @.T       (0,1) spawn  (1,1) path    (2,1) tree
 */

import { expect, test } from "@playwright/test";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

import {
  createPond,
  failOnPageErrors,
  setRetired,
  setStarterExits,
  standAt,
  starterExits,
  storedPosition,
} from "./helpers.js";
import type { MapExit, Position } from "./helpers.js";

const RUN = Date.now().toString(36);
const DOOR: Position = { x: 1, y: 2 };

function mapScreen(page: Page): Locator {
  return page.getByRole("region", { name: "マップ" });
}

async function expectOn(page: Page, mapName: string, x: number, y: number): Promise<void> {
  await expect(mapScreen(page).getByRole("heading")).toHaveText(mapName);
  await expect(mapScreen(page).getByText("現在地:")).toContainText(`(${x}, ${y})`);
}

/**
 * Opens the map, and waits until it is the starter map with the player at
 * (1,1). A key pressed before the map has loaded goes nowhere: there is
 * nothing listening for it yet.
 */
async function openMap(page: Page): Promise<void> {
  await page.goto("/");
  await expectOn(page, "はじまりの草原", 1, 1);
}

/** Which map the server has the player on. */
async function storedMap(request: APIRequestContext): Promise<string> {
  const save = (await (await request.get("/api/save")).json()) as { mapId: string };
  return save.mapId;
}

test.describe("going to another map", () => {
  /** The maps this test made. They are retired afterwards, which also brings the player home. */
  let made: string[] = [];
  let count = 0;

  /** A pond of this test's own, and a door to it on the starter map. */
  async function pondBehindTheDoor(
    request: APIRequestContext,
    arriveAt: Position,
    exits: MapExit[] = [],
  ): Promise<{ id: string; name: string }> {
    count += 1;
    const name = `ほこら-${RUN}-${count}`;
    const id = await createPond(request, name, { exits });
    made.push(id);
    await setStarterExits(request, [{ at: DOOR, to: { mapId: id, position: arriveAt } }]);
    return { id, name };
  }

  test.beforeEach(async ({ page, request }) => {
    failOnPageErrors(page);
    made = [];
    await standAt(request, 1, 1);
  });

  test.afterEach(async ({ request }) => {
    // Whatever happened, the starter map has no door when the next test (or
    // the next run) walks on it, and the player is back on it: with the door
    // gone nothing refers to the ponds, and a retired map sends its players
    // to the start.
    await setStarterExits(request, []);
    for (const id of made) await setRetired(request, "maps", id, true);
    await standAt(request, 1, 1);
  });

  test("marks the way out, and takes the player through it when they step on it", async ({
    page,
    request,
  }) => {
    const pond = await pondBehindTheDoor(request, { x: 1, y: 1 });
    await openMap(page);

    // One door, drawn on the tile it is on: (1,2) of a map 16 wide.
    const doors = await mapScreen(page)
      .locator("[data-tile]")
      .evaluateAll((tiles) =>
        tiles.flatMap((tile, i) => (tile.querySelector("[data-exit]") === null ? [] : [i])),
      );
    expect(doors).toEqual([2 * 16 + 1]);

    await page.keyboard.press("ArrowDown");
    await expectOn(page, pond.name, 1, 1);
    // The server moved the player. The screen only asked.
    expect(await storedMap(request)).toBe(pond.id);
    expect(await storedPosition(request)).toEqual({ x: 1, y: 1 });

    // What is on screen is what a reload shows.
    await page.reload();
    await expectOn(page, pond.name, 1, 1);
  });

  test("walks on the new map, and saves there", async ({ page, request }) => {
    const pond = await pondBehindTheDoor(request, { x: 1, y: 1 });
    await openMap(page);
    await page.keyboard.press("ArrowDown");
    await expectOn(page, pond.name, 1, 1);

    await page.keyboard.press("ArrowLeft");
    await expectOn(page, pond.name, 0, 1);
    await expect(mapScreen(page).getByRole("status")).toHaveText("保存済み");
    expect(await storedMap(request)).toBe(pond.id);
    expect(await storedPosition(request)).toEqual({ x: 0, y: 1 });

    // The pond is 3 wide: the tree at (2,1) and the edge stop the player as they do anywhere.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expectOn(page, pond.name, 1, 1);
  });

  test("does nothing on arriving on an exit, and goes back through it once stepped onto", async ({
    page,
    request,
  }) => {
    // The door arrives on the pond's own exit at (0,0), which leads back to (2,1).
    const back = { at: { x: 0, y: 0 }, to: { mapId: "start", position: { x: 2, y: 1 } } };
    const pond = await pondBehindTheDoor(request, { x: 0, y: 0 }, [back]);
    const asked: string[] = [];
    page.on("request", (sent) => {
      if (new URL(sent.url()).pathname === "/api/travel") asked.push(sent.method());
    });

    await openMap(page);
    await page.keyboard.press("ArrowDown");
    await expectOn(page, pond.name, 0, 0);

    // Off the exit and onto it again: that is what takes it.
    await page.keyboard.press("ArrowRight");
    await expectOn(page, pond.name, 1, 0);
    // Up to here the server was asked once: arriving on the exit asked nothing.
    await expect(mapScreen(page).getByRole("status")).toHaveText("保存済み");
    expect(asked).toEqual(["POST"]);

    await page.keyboard.press("ArrowLeft");
    await expectOn(page, "はじまりの草原", 2, 1);
    expect(asked).toEqual(["POST", "POST"]);
    expect(await storedMap(request)).toBe("start");
  });

  test("asks to go through only once the step onto the exit has been saved", async ({ page }) => {
    const pond = await pondBehindTheDoor(page.request, { x: 1, y: 1 });
    // The save of the step onto the exit is held back. The server goes by the
    // position it has stored, so asking before that save lands would be asking
    // about a tile the server does not yet know the player is on.
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const asked: string[] = [];
    await page.route("**/api/save", async (route) => {
      if (route.request().method() === "PUT") await held;
      await route.continue();
    });
    page.on("request", (sent) => {
      if (new URL(sent.url()).pathname === "/api/travel") asked.push(sent.method());
    });

    await openMap(page);
    await page.keyboard.press("ArrowDown");
    await expectOn(page, "はじまりの草原", 1, 2);
    await expect(mapScreen(page).getByRole("status")).toHaveText("保存中…");
    expect(asked).toEqual([]);

    release();
    await expectOn(page, pond.name, 1, 1);
    expect(asked).toEqual(["POST"]);
  });

  test("holds the player still while the server is taking them through", async ({ page }) => {
    const pond = await pondBehindTheDoor(page.request, { x: 1, y: 1 });
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/travel", async (route) => {
      await held;
      await route.continue();
    });

    await openMap(page);
    await page.keyboard.press("ArrowDown");
    await expect(mapScreen(page).locator("[data-travelling]")).toBeVisible();

    // A step now would be a save on a map the player is leaving.
    await page.keyboard.press("ArrowUp");
    await mapScreen(page).getByRole("button", { name: "上へ" }).click();
    await expectOn(page, "はじまりの草原", 1, 2);

    release();
    await expectOn(page, pond.name, 1, 1);
  });

  test("says so when the server will not let the player through, and lets them walk on", async ({
    page,
    request,
  }) => {
    await pondBehindTheDoor(request, { x: 1, y: 1 });
    await page.route("**/api/travel", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: { kind: "no_exit_here" } }),
      }),
    );

    await openMap(page);
    await page.keyboard.press("ArrowDown");
    await expect(mapScreen(page).getByRole("alert")).toHaveText(
      "出口を通れなかった（no_exit_here）",
    );
    await expectOn(page, "はじまりの草原", 1, 2);
    expect(await storedMap(request)).toBe("start");

    await page.keyboard.press("ArrowUp");
    await expectOn(page, "はじまりの草原", 1, 1);
    await expect(mapScreen(page).getByRole("alert")).toHaveCount(0);
  });

  test("is set up from the admin screen: an exit put on a map is one a player can take", async ({
    page,
    request,
  }) => {
    count += 1;
    const name = `ほこら-${RUN}-${count}`;
    const id = await createPond(request, name);
    made.push(id);

    await page.goto("/admin/#/maps");
    await page
      .getByRole("list", { name: "マップの一覧" })
      .getByRole("button", { name: /はじまりの草原/ })
      .click();
    const form = page.getByRole("form", { name: "マップのフォーム" });
    const tiles = form.getByRole("group", { name: "タイル" }).getByRole("button");
    const door = tiles.nth(DOOR.y * 16 + DOOR.x);
    const exit = form.getByRole("group", { name: "出口 (1, 2)" });

    await form.getByRole("group", { name: "筆" }).getByRole("button", { name: "出口" }).click();
    // A tree is not somewhere to put one.
    await tiles.nth(0).click();
    await expect(form.getByRole("group", { name: /^出口 \(/ })).toHaveCount(0);
    await door.click();
    await expect(door).toHaveAttribute("data-exit", "");

    // Pointed at a map, it arrives where a new game there would start — also
    // after the position was typed over. Which map a new exit points at to
    // begin with depends on what other tests left behind, so two maps are
    // chosen here, one after the other, and neither result is left to chance.
    await exit.getByLabel("行き先のマップ").selectOption("start");
    await expect(exit.getByLabel("行き先の x")).toHaveValue("1");
    await expect(exit.getByLabel("行き先の y")).toHaveValue("1");
    await exit.getByLabel("行き先の x").fill("7");
    await exit.getByLabel("行き先のマップ").selectOption(id);
    await expect(exit.getByLabel("行き先の x")).toHaveValue("0");
    await expect(exit.getByLabel("行き先の y")).toHaveValue("1");

    // The pond's (2,1) is a tree, and the server says so.
    await exit.getByLabel("行き先の x").fill("2");
    await form.getByRole("button", { name: "保存", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("bad_exit_destination");
    expect(await starterExits(request)).toEqual([]);

    await exit.getByLabel("行き先の x").fill("1");
    await form.getByRole("button", { name: "保存", exact: true }).click();
    await expect(form.getByRole("status")).toHaveText("保存した");
    expect(await starterExits(request)).toEqual([
      { at: DOOR, to: { mapId: id, position: { x: 1, y: 1 } } },
    ]);

    // And the player can take it.
    await openMap(page);
    await page.keyboard.press("ArrowDown");
    await expectOn(page, name, 1, 1);

    // Pressed again with the same brush, the exit is gone — from the form, and once saved, from the map.
    await page.goto("/admin/#/maps");
    await page
      .getByRole("list", { name: "マップの一覧" })
      .getByRole("button", { name: /はじまりの草原/ })
      .click();
    await form.getByRole("group", { name: "筆" }).getByRole("button", { name: "出口" }).click();
    await door.click();
    await expect(exit).toHaveCount(0);
    await form.getByRole("button", { name: "保存", exact: true }).click();
    await expect(form.getByRole("status")).toHaveText("保存した");
    expect(await starterExits(request)).toEqual([]);
  });
});
