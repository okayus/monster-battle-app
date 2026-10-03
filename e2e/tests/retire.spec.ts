/**
 * Retiring: taking something out of use without deleting it, and what that
 * looks like from the game.
 *
 * Every test here makes the things it retires — a move, a species, a map, a
 * skin of its own — and leaves what ships with the game alone. The other test
 * files meet those monsters in the grass.
 */

import { expect, test } from "@playwright/test";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

import {
  DEFAULT_LOOK,
  createPond,
  drawBars,
  failOnPageErrors,
  playerOnTheMap,
  rows,
  setRetired,
  standAt,
  visit,
  wear,
  worn,
} from "./helpers.js";
import type { PaletteEntry } from "./helpers.js";

const RUN = Date.now().toString(36);

const PALETTE: PaletteEntry[] = [
  { id: "skin", hex: "#e8b98a" },
  { id: "shirt", hex: "#3f7bd6" },
  { id: "pants", hex: "#2f3a56" },
  { id: "shoes", hex: "#7a4a2a" },
  { id: "hair", hex: "#5a3921" },
];

/** Where the bars of a skin drawn by `drawBars(…, 0)` are, and where the default skin's parts start. */
const ROWS_OF_BARS = { body: 0, shirt: 1, pants: 2, shoes: 3, hair: 4 };
const ROWS_OF_DEFAULT = { body: 3, shirt: 8, pants: 12, shoes: 15, hair: 1 };

async function created(response: Awaited<ReturnType<APIRequestContext["post"]>>, what: string) {
  expect(response.status(), what).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

function createMove(request: APIRequestContext, name: string): Promise<string> {
  return request
    .post("/api/admin/moves", { data: { name, power: 4 } })
    .then((response) => created(response, `POST a move (${name})`));
}

function createSpecies(
  request: APIRequestContext,
  name: string,
  moveIds: string[],
): Promise<string> {
  return request
    .post("/api/admin/species", {
      data: { name, maxHp: 20, attack: 10, defense: 10, skinId: "species-moss", moveIds },
    })
    .then((response) => created(response, `POST a species (${name})`));
}

/** Opens an admin screen and waits for its list. */
async function open(page: Page, screen: "species" | "moves" | "maps" | "skins"): Promise<Locator> {
  const names = {
    species: "種族の一覧",
    moves: "技の一覧",
    maps: "マップの一覧",
    skins: "スキンの一覧",
  };
  await page.goto(`/admin/#/${screen}`);
  const list = page.getByRole("list", { name: names[screen] });
  await expect(list.getByRole("listitem").first()).toBeVisible();
  return list;
}

/** Opens a screen with a form, and loads the named item into it. */
async function choose(
  page: Page,
  screen: "species" | "moves" | "maps",
  name: string,
): Promise<Locator> {
  const list = await open(page, screen);
  await list.getByRole("button", { name: new RegExp(name) }).click();
  return list.getByRole("listitem").filter({ hasText: name });
}

function control(scope: Page | Locator): Locator {
  return scope.getByRole("group", { name: "retire" });
}

test.describe("retiring", () => {
  test.beforeEach(({ page }) => {
    failOnPageErrors(page);
  });

  test("will not retire a move a species still knows, and does once the species gives it up", async ({
    page,
    request,
  }) => {
    const moveName = `ひっかく-${RUN}`;
    const speciesName = `ヒッカキダマ-${RUN}`;
    const move = await createMove(request, moveName);
    await createSpecies(request, speciesName, [move, "bump"]);
    const speciesForm = page.getByRole("form", { name: "種族のフォーム" });

    await choose(page, "moves", moveName);
    await control(page).getByRole("button", { name: "retire する" }).click();
    // The refusal says who is in the way, by name.
    await expect(control(page).getByRole("alert")).toContainText("retire できない");
    await expect(control(page).getByRole("alert")).toContainText(`種族: ${speciesName}`);

    await choose(page, "species", speciesName);
    await speciesForm.getByRole("checkbox", { name: new RegExp(moveName) }).uncheck();
    await speciesForm.getByRole("button", { name: "保存", exact: true }).click();
    await expect(speciesForm.getByRole("status")).toHaveText("保存した");

    const listed = await choose(page, "moves", moveName);
    await control(page).getByRole("button", { name: "retire する" }).click();
    await expect(control(page).getByRole("button", { name: "戻す" })).toBeVisible();
    // Still there, and marked: nothing was deleted.
    await expect(listed).toContainText("retire 済み");

    // No species is offered it any more …
    await open(page, "species");
    await page.getByRole("button", { name: "新しい種族" }).click();
    await expect(speciesForm.getByRole("checkbox", { name: /かじる/ })).toBeVisible();
    await expect(speciesForm.getByRole("checkbox", { name: new RegExp(moveName) })).toHaveCount(0);

    // … until it is brought back.
    await choose(page, "moves", moveName);
    await control(page).getByRole("button", { name: "戻す" }).click();
    await expect(control(page).getByRole("button", { name: "retire する" })).toBeVisible();
    await open(page, "species");
    await page.getByRole("button", { name: "新しい種族" }).click();
    await expect(speciesForm.getByRole("checkbox", { name: new RegExp(moveName) })).toBeVisible();
  });

  test("will not retire a species a map still lists, and stops offering it to maps once it is", async ({
    page,
    request,
  }) => {
    const speciesName = `イケダマ-${RUN}`;
    const mapName = `ためいけ-${RUN}`;
    const kind = await createSpecies(request, speciesName, ["bump"]);
    await createPond(request, mapName, { speciesIds: [kind] });
    const mapForm = page.getByRole("form", { name: "マップのフォーム" });

    await choose(page, "species", speciesName);
    await control(page).getByRole("button", { name: "retire する" }).click();
    await expect(control(page).getByRole("alert")).toContainText(`マップ: ${mapName}`);

    // Off the map first: a weight of 0 is "does not turn up".
    await choose(page, "maps", mapName);
    await mapForm.getByLabel(speciesName).fill("0");
    await mapForm.getByRole("button", { name: "保存", exact: true }).click();
    await expect(mapForm.getByRole("status")).toHaveText("保存した");

    const listed = await choose(page, "species", speciesName);
    await control(page).getByRole("button", { name: "retire する" }).click();
    await expect(control(page).getByRole("button", { name: "戻す" })).toBeVisible();
    await expect(listed).toContainText("retire 済み");

    await open(page, "maps");
    await page.getByRole("button", { name: "新しいマップ" }).click();
    await expect(mapForm.getByLabel("ヌマダマ")).toBeVisible();
    await expect(mapForm.getByLabel(speciesName)).toHaveCount(0);
  });

  test("says what has to come back first when a species still knows a retired move", async ({
    page,
    request,
  }) => {
    const moveName = `かみつく-${RUN}`;
    const speciesName = `カミツキダマ-${RUN}`;
    const move = await createMove(request, moveName);
    const kind = await createSpecies(request, speciesName, [move]);
    // The species first: once it is retired, nothing in use knows the move.
    await setRetired(request, "species", kind, true);
    await setRetired(request, "moves", move, true);

    await choose(page, "species", speciesName);
    await control(page).getByRole("button", { name: "戻す" }).click();
    await expect(control(page).getByRole("alert")).toContainText("戻せない");
    await expect(control(page).getByRole("alert")).toContainText(`技: ${moveName}`);
    // The retired move is still shown on the species that has it, so it can be given up.
    await expect(
      page
        .getByRole("form", { name: "種族のフォーム" })
        .getByRole("checkbox", { name: new RegExp(moveName) }),
    ).toBeChecked();
  });

  test("takes a retired skin out of the wardrobe and off whoever wears it, and gives the look back", async ({
    page,
    request,
  }) => {
    const skinName = `しましま-${RUN}`;
    const skin = await drawBars(request, skinName, PALETTE, 0);
    await wear(request, { skinId: skin, parts: {}, colours: [] });
    await page.goto("/");
    expect(await rows(await playerOnTheMap(page))).toEqual(ROWS_OF_BARS);

    const skins = await open(page, "skins");
    const item = skins.getByRole("listitem").filter({ hasText: skinName });
    await item.getByRole("button", { name: "retire する" }).click();
    await expect(item.getByRole("button", { name: "戻す" })).toBeVisible();
    await expect(item).toContainText("retire 済み");

    // The player did nothing, and is in the default skin.
    expect(await worn(request)).toEqual(DEFAULT_LOOK);
    await page.goto("/");
    expect(await rows(await playerOnTheMap(page))).toEqual(ROWS_OF_DEFAULT);

    // It is not offered to wear.
    await page.goto("/#/look");
    const choice = page.getByRole("region", { name: "きがえ" }).getByLabel("着るスキン");
    await expect(choice).toHaveValue("player-default");
    await expect(choice.locator(`option[value="${skin}"]`)).toHaveCount(0);

    // Brought back, the look is back too: nothing of the player's was overwritten.
    await open(page, "skins");
    await item.getByRole("button", { name: "戻す" }).click();
    await expect(item.getByRole("button", { name: "retire する" })).toBeVisible();
    expect(await worn(request)).toEqual({ skinId: skin, parts: {}, colours: [] });
    await page.goto("/");
    expect(await rows(await playerOnTheMap(page))).toEqual(ROWS_OF_BARS);

    await wear(request, DEFAULT_LOOK);
  });

  test("sends a player on a retired map back to the start, and puts them back when it returns", async ({
    page,
    request,
  }) => {
    const mapName = `こいけ-${RUN}`;
    const map = await createPond(request, mapName);
    // Through an exit: a save cannot put a player on another map.
    await visit(request, map, { x: 1, y: 0 });
    const mapScreen = page.getByRole("region", { name: "マップ" });

    await page.goto("/");
    await expect(mapScreen.getByRole("heading")).toHaveText(mapName);

    await choose(page, "maps", mapName);
    await control(page).getByRole("button", { name: "retire する" }).click();
    await expect(control(page).getByRole("button", { name: "戻す" })).toBeVisible();

    // The player did nothing, and is at the start of the first map.
    await page.goto("/");
    await expect(mapScreen.getByRole("heading")).toHaveText("はじまりの草原");
    await expect(mapScreen.getByText("現在地:")).toContainText("(1, 1)");

    await choose(page, "maps", mapName);
    await control(page).getByRole("button", { name: "戻す" }).click();
    await expect(control(page).getByRole("button", { name: "retire する" })).toBeVisible();

    // Back where they were: the save was never rewritten.
    await page.goto("/");
    await expect(mapScreen.getByRole("heading")).toHaveText(mapName);
    await expect(mapScreen.getByText("現在地:")).toContainText("(1, 0)");

    // Leave the player where the other tests expect them. Retiring the map
    // again is the way back: a save cannot change maps either.
    await setRetired(request, "maps", map, true);
    await standAt(request, 1, 1);
  });

  test("will not retire what everything else falls back to", async ({ page, request }) => {
    await choose(page, "maps", "はじまりの草原");
    await control(page).getByRole("button", { name: "retire する" }).click();
    await expect(control(page).getByRole("alert")).toContainText("戻り先");

    const skins = await open(page, "skins");
    const item = skins.getByRole("listitem").filter({ hasText: "はじめのすがた" });
    await item.getByRole("button", { name: "retire する" }).click();
    await expect(item.getByRole("alert")).toContainText("戻り先");

    // Neither is marked.
    const maps = (await (await request.get("/api/admin/maps")).json()) as {
      id: string;
      retired: boolean;
    }[];
    expect(maps.find((map) => map.id === "start")?.retired).toBe(false);
    const all = (await (await request.get("/api/admin/skins")).json()) as {
      id: string;
      retired: boolean;
    }[];
    expect(all.find((skin) => skin.id === "player-default")?.retired).toBe(false);
  });
});
