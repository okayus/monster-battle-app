/**
 * Growth: what a battle leaves behind.
 *
 * A battle won leaves the monster with experience and without the health it
 * lost; a battle lost leaves it restored, and the player back at the start.
 * All of that is written by the server, in the turn that ends the battle.
 * What these tests check is that the screens say what the server wrote.
 *
 * The server rolls real dice, so the outcome is arranged by who is fought
 * (see `arena` in helpers.ts): a monster that faints at the first hit, one
 * that takes two hits and lands one, and one that cannot be beaten. Each
 * lives alone on a pond of its own:
 *
 *        012
 *      0 .gw       (1,0) the grass, where the test puts the player
 *      1 @.T       (0,1) the way back to the starter map
 *
 * The player's monster keeps what it earns from one test to the next, and
 * from one run to the next on a server that is not started afresh. So nothing
 * below assumes a level: every number is read from the server before and
 * after, and compared.
 */

import { expect, test } from "@playwright/test";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

import {
  POND_GRASS,
  arena,
  closeArenas,
  failOnPageErrors,
  finishBattle,
  goHome,
  leadMonster,
  rest,
  visit,
} from "./helpers.js";

function battle(page: Page): Locator {
  return page.getByRole("region", { name: "バトル" });
}

function monsters(page: Page): Locator {
  return page.getByRole("region", { name: "なかま" });
}

function nav(page: Page, name: string): Locator {
  return page.getByRole("navigation", { name: "画面" }).getByRole("link", { name, exact: true });
}

function hpBar(page: Page, side: "こちら" | "あいて"): Locator {
  return battle(page).getByRole("progressbar", { name: `${side}の HP` });
}

async function health(page: Page, side: "こちら" | "あいて"): Promise<number> {
  return Number(await hpBar(page, side).getAttribute("value"));
}

function firstMove(page: Page): Locator {
  return battle(page).getByRole("group", { name: "技" }).getByRole("button").first();
}

function log(page: Page): Locator {
  return battle(page).getByRole("list", { name: "ログ" }).getByRole("listitem");
}

/** From the map into a battle, by the button a player presses. Hands back the battle's address. */
async function search(page: Page): Promise<string> {
  await page.getByRole("button", { name: "草むらを調べる" }).click();
  await expect(page).toHaveURL(/#\/battles\/[0-9a-f-]+$/);
  await expect(battle(page).getByRole("group", { name: "技" })).toBeVisible();
  return page.url();
}

/** Where the server has the player: which map, and where on it. */
async function whereabouts(request: APIRequestContext) {
  return (await (await request.get("/api/save")).json()) as {
    mapId: string;
    position: { x: number; y: number };
  };
}

test.describe("what a battle leaves behind", () => {
  test.beforeEach(async ({ page, request }) => {
    failOnPageErrors(page);
    // Home, in no battle, at full health: whatever the test before this one did.
    await rest(request);
  });

  test.afterAll(async ({ request }) => {
    await closeArenas(request);
  });

  test("lists the player's monster with the level and the health the server gives it", async ({
    page,
    request,
  }) => {
    // Hurt, and with something earned. A list that showed every monster as
    // new and unhurt would pass against a monster that is exactly that.
    const pond = await arena(request, "scratcher");
    await visit(request, pond.mapId, POND_GRASS);
    expect((await request.post("/api/battles")).status()).toBe(201);
    await finishBattle(request);
    const mine = await leadMonster(request);
    expect(mine.hp).toBe(mine.maxHp - 1);
    expect(mine.level).toBeGreaterThan(1);
    expect(mine.exp).toBeGreaterThan(0);

    await page.goto("/");
    await nav(page, "なかま").click();
    await expect(page).toHaveURL(/#\/monsters$/);

    const card = monsters(page)
      .getByRole("list", { name: "なかまの一覧" })
      .getByRole("listitem")
      .first();
    await expect(card.locator("strong")).toHaveText(mine.name);
    await expect(card.locator("[data-level]")).toHaveText(`Lv ${mine.level}`);
    await expect(card.locator("[data-hp]")).toHaveText(`HP ${mine.hp} / ${mine.maxHp}`);
    await expect(card.getByRole("progressbar")).toHaveAttribute("value", String(mine.hp));
    await expect(card.getByRole("progressbar")).toHaveAttribute("max", String(mine.maxHp));
    const toGo =
      mine.nextLevelAt === null
        ? "これ以上は上がらない"
        : `つぎのレベルまで あと ${mine.nextLevelAt - mine.exp}`;
    await expect(card.locator("[data-exp]")).toHaveText(`経験値 ${mine.exp}（${toGo}）`);
    await expect(card).toContainText(`攻撃 ${mine.attack} / 防御 ${mine.defense}`);
    // The picture is a skin fetched from the API and drawn by <Sprite>.
    await expect(card.locator("svg rect").first()).toBeAttached();
    // It is in no battle, so there is nowhere to go on to.
    await expect(card.getByRole("link")).toHaveCount(0);
  });

  test("writes a win to the monster, and says on the screen what was written", async ({
    page,
    request,
  }) => {
    const before = await leadMonster(request);
    const pond = await arena(request, "pushover");
    await visit(request, pond.mapId, POND_GRASS);

    await page.goto("/");
    await search(page);
    await expect(battle(page).getByRole("group", { name: "あいて" }).locator("strong")).toHaveText(
      `やせいの ${pond.speciesName}`,
    );
    await firstMove(page).click();
    await expect(battle(page).getByRole("status")).toHaveText("勝った！");

    // The server has already written it down by the time the screen says so.
    const after = await leadMonster(request);
    const gained = after.exp - before.exp;
    expect(gained).toBeGreaterThan(0);
    await expect(log(page).filter({ hasText: "経験値" })).toHaveText(
      `${after.name} は 経験値を ${gained} 手に入れた`,
    );
    // It was beaten before it could answer: nothing was lost.
    expect(after.hp).toBe(after.maxHp);
    expect(after.battleId).toBeNull();
    // A win does not move the player.
    expect(await whereabouts(request)).toEqual({ mapId: pond.mapId, position: POND_GRASS });

    // The monsters screen shows the same numbers, from the server.
    await nav(page, "なかま").click();
    const card = monsters(page).getByRole("listitem").first();
    await expect(card.locator("[data-exp]")).toContainText(`経験値 ${after.exp}（`);
    await expect(card.locator("[data-level]")).toHaveText(`Lv ${after.level}`);
  });

  test("takes into the next battle the health the last one left", async ({ page, request }) => {
    const before = await leadMonster(request);
    const pond = await arena(request, "scratcher");
    await visit(request, pond.mapId, POND_GRASS);

    await page.goto("/");
    const first = await search(page);
    // Rested, so it goes in with all the health it can have at its level.
    await expect(hpBar(page, "こちら")).toHaveAttribute("max", String(before.maxHp));
    expect(await health(page, "こちら")).toBe(before.maxHp);
    await expect(
      battle(page).getByRole("group", { name: "こちら" }).locator("[data-level]"),
    ).toHaveText(`Lv ${before.level}`);
    await expect(
      battle(page).getByRole("group", { name: "あいて" }).locator("[data-level]"),
    ).toHaveText("Lv 1");

    // The first hit leaves it standing, and it answers for exactly 1.
    await firstMove(page).click();
    await expect.poll(() => health(page, "こちら")).toBe(before.maxHp - 1);
    expect(await health(page, "あいて")).toBe(1);
    await firstMove(page).click();
    await expect(battle(page).getByRole("status")).toHaveText("勝った！");
    await expect(battle(page).locator("[data-aftermath]")).toHaveText(
      "減った HP は、次のバトルに持ち越す。",
    );

    // One point is gone, whatever level the win has taken the monster to.
    const after = await leadMonster(request);
    expect(after.maxHp - after.hp).toBe(1);
    expect(after.exp).toBeGreaterThan(before.exp);
    // The screen announces a new level exactly when there is one.
    const levelLine = log(page).filter({ hasText: "レベル" });
    if (after.level > before.level) {
      await expect(levelLine).toHaveText(`${after.name} は レベル ${after.level} に上がった！`);
    } else {
      await expect(levelLine).toHaveCount(0);
    }

    // Straight into another battle, from the same grass.
    await battle(page).getByRole("link", { name: "マップに戻る" }).click();
    const second = await search(page);
    expect(second).not.toBe(first);
    await expect(hpBar(page, "こちら")).toHaveAttribute("max", String(after.maxHp));
    expect(await health(page, "こちら")).toBe(after.maxHp - 1);
    await expect(
      battle(page).getByRole("group", { name: "こちら" }).locator("[data-level]"),
    ).toHaveText(`Lv ${after.level}`);
    // The wild one is a new monster, and unhurt.
    expect(await health(page, "あいて")).toBe(2);
  });

  test("restores the monster after a loss, puts the player back at the start, and says so", async ({
    page,
    request,
  }) => {
    // Hurt first, so that being restored is something that can be seen.
    const scratcher = await arena(request, "scratcher");
    await visit(request, scratcher.mapId, POND_GRASS);
    expect((await request.post("/api/battles")).status()).toBe(201);
    await finishBattle(request);
    const hurt = await leadMonster(request);
    expect(hurt.maxHp - hurt.hp).toBe(1);
    await goHome(request);

    const pond = await arena(request, "crusher");
    await visit(request, pond.mapId, POND_GRASS);
    await page.goto("/");
    await expect(page.getByRole("region", { name: "マップ" }).getByRole("heading")).toHaveText(
      pond.mapName,
    );
    await search(page);
    expect(await health(page, "こちら")).toBe(hurt.hp);

    await firstMove(page).click();
    await expect(battle(page).getByRole("status")).toHaveText("負けてしまった…");
    await expect(battle(page).locator("[data-aftermath]")).toHaveText(
      `${hurt.name} は げんきになり、はじまりの場所に戻された。`,
    );
    // Nothing was earned, and the log does not say anything was.
    await expect(log(page).filter({ hasText: "経験値" })).toHaveCount(0);

    const after = await leadMonster(request);
    expect(after.exp).toBe(hurt.exp);
    expect(after.hp).toBe(after.maxHp);
    expect(after.battleId).toBeNull();
    expect(await whereabouts(request)).toEqual({ mapId: "start", position: { x: 1, y: 1 } });

    // The map the screen goes back to is the one the server put the player on.
    await battle(page).getByRole("link", { name: "マップに戻る" }).click();
    const map = page.getByRole("region", { name: "マップ" });
    await expect(map.getByRole("heading")).toHaveText("はじまりの草原");
    await expect(map.getByText("現在地:")).toContainText("(1, 1)");
  });

  test("goes back to a battle that is not over, from the grass and from the monsters screen", async ({
    page,
    request,
  }) => {
    const pond = await arena(request, "scratcher");
    await visit(request, pond.mapId, POND_GRASS);

    await page.goto("/");
    const first = await search(page);
    await firstMove(page).click();
    await expect.poll(() => health(page, "あいて")).toBe(1);
    const mine = await health(page, "こちら");

    // Walking away from it does not end it…
    await nav(page, "マップ").click();
    await expect(page.getByRole("region", { name: "マップ" }).getByRole("heading")).toHaveText(
      pond.mapName,
    );
    // …and searching the grass again does not start another.
    expect(await search(page)).toBe(first);
    expect(await health(page, "あいて")).toBe(1);
    expect(await health(page, "こちら")).toBe(mine);

    // The monsters screen knows the way back as well.
    await nav(page, "なかま").click();
    const card = monsters(page).getByRole("listitem").first();
    await card.getByRole("link", { name: "バトルの途中。つづきへ" }).click();
    await expect(page).toHaveURL(first);
    await expect(hpBar(page, "あいて")).toHaveAttribute("value", "1");

    // Once it is over, there is nothing to go back to.
    await firstMove(page).click();
    await expect(battle(page).getByRole("status")).toHaveText("勝った！");
    await nav(page, "なかま").click();
    await expect(
      monsters(page).getByRole("listitem").first().locator("[data-level]"),
    ).toBeVisible();
    await expect(monsters(page).getByRole("link", { name: "バトルの途中。つづきへ" })).toHaveCount(
      0,
    );
  });

  test("says so when the monsters cannot be loaded", async ({ page }) => {
    await page.route("**/api/monsters", (route) =>
      route.fulfill({ status: 500, json: { error: { kind: "broken" } } }),
    );
    await page.goto("/#/monsters");
    await expect(monsters(page).getByRole("alert")).toHaveText(
      "なかまを読み込めなかった（broken）",
    );
  });
});
