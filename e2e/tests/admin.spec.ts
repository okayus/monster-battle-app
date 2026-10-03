/**
 * The admin app: species and maps.
 *
 * It lives under /admin and talks to /api/admin. Both paths are the same
 * origin as the player app in production, which is part of what these tests
 * are checking.
 */

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { failOnPageErrors, stroke } from "./helpers.js";

interface Species {
  id: string;
  name: string;
  attack: number;
  moves: { id: string }[];
}

interface AdminMap {
  id: string;
  name: string;
  tiles: string[];
  spawn: { x: number; y: number };
  encounters: { speciesId: string; weight: number }[];
}

/**
 * Part of every name these tests create. A compose run starts from an empty
 * database, but the suite can also be pointed at a server that has been run
 * against before, and "the one species called X" has to stay true there.
 */
const RUN = Date.now().toString(36);
const SPECIES_NAME = `テストダマ-${RUN}`;
const MAP_NAME = `テストの原っぱ-${RUN}`;

function speciesList(page: Page): Locator {
  return page.getByRole("list", { name: "種族の一覧" });
}

function speciesForm(page: Page): Locator {
  return page.getByRole("form", { name: "種族のフォーム" });
}

function mapForm(page: Page): Locator {
  return page.getByRole("form", { name: "マップのフォーム" });
}

function tile(page: Page, x: number, y: number): Locator {
  return mapForm(page)
    .getByRole("group", { name: "タイル" })
    .getByRole("button")
    .nth(y * 16 + x);
}

async function tiles(page: Page): Promise<string[]> {
  return mapForm(page)
    .getByRole("group", { name: "タイル" })
    .getByRole("button")
    .evaluateAll((cells) => cells.map((one) => (one as HTMLElement).dataset.tile ?? ""));
}

async function spawnIndex(page: Page): Promise<number> {
  return mapForm(page)
    .getByRole("group", { name: "タイル" })
    .getByRole("button")
    .evaluateAll((cells) =>
      cells.findIndex((one) => (one as HTMLElement).dataset.spawn !== undefined),
    );
}

function brush(page: Page, name: string): Locator {
  return mapForm(page)
    .getByRole("group", { name: "筆" })
    .getByRole("button", { name, exact: true });
}

test.describe("the admin app", () => {
  test.beforeEach(async ({ page }) => {
    failOnPageErrors(page);
    await page.goto("/admin/");
    await expect(speciesList(page).getByRole("listitem").first()).toBeVisible();
  });

  test("lists the species, each drawn with its look", async ({ page }) => {
    for (const name of ["モリダマ", "ヌマダマ", "イワダマ"]) {
      const item = speciesList(page).getByRole("listitem").filter({ hasText: name });
      await expect(item).toHaveCount(1);
      // The same <Sprite>, fed by the same endpoint, as the player's screens.
      await expect(item.locator("svg rect").first()).toBeAttached();
    }
  });

  test("loads a species into the form", async ({ page }) => {
    await speciesList(page)
      .getByRole("button", { name: /モリダマ/ })
      .click();
    const form = speciesForm(page);

    await expect(form.getByLabel("名前")).toHaveValue("モリダマ");
    await expect(form.getByLabel("最大 HP")).toHaveValue("24");
    await expect(form.getByLabel("攻撃")).toHaveValue("9");
    await expect(form.getByLabel("防御")).toHaveValue("9");
    await expect(form.getByLabel("見た目")).toHaveValue("species-moss");
    await expect(form.locator('[data-skin="species-moss"] svg rect').first()).toBeAttached();
    await expect(form.getByRole("checkbox", { name: /かじる/ })).toBeChecked();
    await expect(form.getByRole("checkbox", { name: /ぶつかる/ })).toBeChecked();
    await expect(form.getByRole("checkbox", { name: /はねとばす/ })).not.toBeChecked();
  });

  test("creates a species, edits it, and shows what the server refuses", async ({
    page,
    request,
  }) => {
    const form = speciesForm(page);
    const save = form.getByRole("button", { name: "保存", exact: true });
    const created = speciesList(page).getByRole("listitem").filter({ hasText: SPECIES_NAME });

    await page.getByRole("button", { name: "新しい種族" }).click();
    await form.getByLabel("名前").fill(SPECIES_NAME);
    await form.getByLabel("最大 HP").fill("31");
    await form.getByLabel("攻撃").fill("12");
    await form.getByLabel("防御").fill("6");
    await form.getByLabel("見た目").selectOption("species-rock");
    await form.getByRole("checkbox", { name: /かじる/ }).check();
    await form.getByRole("checkbox", { name: /はねとばす/ }).check();
    await save.click();

    await expect(form.getByRole("status")).toHaveText("保存した");
    await expect(created).toContainText("HP 31 / 攻 12 / 防 6");
    await expect(created).toContainText("かじる・はねとばす");

    await form.getByLabel("攻撃").fill("15");
    await save.click();
    await expect(created).toContainText("攻 15");

    // A refusal is the server's, shown as it came.
    await form.getByLabel("名前").fill("");
    await save.click();
    await expect(form.getByRole("alert")).toHaveText("保存できなかった（bad_name）");
    await form.getByLabel("名前").fill(SPECIES_NAME);
    await form.getByRole("checkbox", { name: /かじる/ }).uncheck();
    await form.getByRole("checkbox", { name: /はねとばす/ }).uncheck();
    await save.click();
    await expect(form.getByRole("alert")).toContainText("bad_move_count");

    // Neither refusal changed what is stored.
    const stored = ((await (await request.get("/api/admin/species")).json()) as Species[]).find(
      (one) => one.name === SPECIES_NAME,
    );
    expect(stored?.attack).toBe(15);
    expect(stored?.moves.map((move) => move.id)).toEqual(["bite", "fling"]);
  });

  test("offers a skin a player drew as a monster's look", async ({ page, request }) => {
    const blank = { durationMs: 120, cells: [[0, 256]] };
    const drawn = await request.post("/api/skins", {
      data: {
        formatVersion: 1,
        name: "プレイヤーの絵",
        palette: [{ id: "ink", hex: "#333333" }],
        parts: ["body", "shirt", "pants", "shoes", "hair"].map((slot) => ({
          slot,
          frames: [
            slot === "body"
              ? {
                  durationMs: 120,
                  cells: [
                    [1, 16],
                    [0, 240],
                  ],
                }
              : blank,
          ],
        })),
      },
    });
    expect(drawn.status()).toBe(201);
    const { id } = (await drawn.json()) as { id: string };

    await page.reload();
    const form = speciesForm(page);
    await form.getByLabel("見た目").selectOption(id);
    await expect(form.locator(`[data-skin="${id}"] svg rect`).first()).toBeAttached();
    await expect(form.getByLabel("見た目").locator(`option[value="${id}"]`)).toHaveText(
      "プレイヤーの絵（プレイヤー作）",
    );
  });

  test("paints a map, keeps the spawn standable, and the game serves what was saved", async ({
    page,
    request,
  }) => {
    await page.getByRole("navigation").getByRole("link", { name: "マップ" }).click();
    const form = mapForm(page);

    // The starter map loads as it is stored: 16×12, spawn at (1,1).
    await expect(form.getByLabel("名前")).toHaveValue("はじまりの草原");
    await expect.poll(() => tiles(page)).toHaveLength(16 * 12);
    await expect.poll(() => spawnIndex(page)).toBe(1 * 16 + 1);

    await page.getByRole("button", { name: "新しいマップ" }).click();
    await expect.poll(async () => new Set(await tiles(page))).toEqual(new Set(["path"]));
    await form.getByLabel("名前").fill(MAP_NAME);

    // A row of trees across the top. The spawn is at (0,0), and a tree there
    // would leave a new game stuck, so that one tile stays a path.
    await brush(page, "木").click();
    await stroke(page, tile(page, 0, 0), tile(page, 15, 0));
    await expect
      .poll(async () => (await tiles(page)).slice(0, 16))
      .toEqual(["path", ...Array<string>(15).fill("tree")]);

    await brush(page, "草むら").click();
    await stroke(page, tile(page, 3, 2), tile(page, 3, 8));
    await expect
      .poll(async () => (await tiles(page)).filter((kind) => kind === "grass"))
      .toHaveLength(7);

    // The spawn moves to a path, and refuses a tree.
    await brush(page, "開始位置").click();
    await tile(page, 5, 0).click();
    await expect.poll(() => spawnIndex(page)).toBe(0);
    await tile(page, 5, 5).click();
    await expect.poll(() => spawnIndex(page)).toBe(5 * 16 + 5);
    await brush(page, "木").click();
    await tile(page, 5, 5).click();
    await expect.poll(async () => (await tiles(page))[5 * 16 + 5]).toBe("path");

    await form.getByLabel("ヌマダマ").fill("4");
    const painted = await tiles(page);
    await form.getByRole("button", { name: "保存", exact: true }).click();
    await expect(form.getByRole("status")).toHaveText("保存した");

    // What the admin API stored, and what the game API hands to players.
    const stored = ((await (await request.get("/api/admin/maps")).json()) as AdminMap[]).find(
      (one) => one.name === MAP_NAME,
    );
    expect(stored?.spawn).toEqual({ x: 5, y: 5 });
    expect(stored?.encounters).toEqual([{ speciesId: "drop", weight: 4 }]);
    const served = (await (await request.get(`/api/maps/${stored?.id}`)).json()) as AdminMap;
    expect(served.tiles).toEqual(painted);

    // And it is there to be picked again after a reload.
    await page.reload();
    await page
      .getByRole("list", { name: "マップの一覧" })
      .getByRole("button", { name: new RegExp(MAP_NAME) })
      .click();
    await expect(form.getByLabel("名前")).toHaveValue(MAP_NAME);
    await expect.poll(() => tiles(page)).toEqual(painted);
  });
});
