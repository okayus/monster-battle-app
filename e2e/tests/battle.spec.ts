/**
 * Battles: started from the grass, decided by the server.
 *
 * The server draws real random numbers here, so nothing below assumes who
 * turns up, how hard a hit lands or who wins. What is checked is what must
 * hold whatever is rolled.
 *
 * A battle leaves things behind: the monster's health carries over, and a
 * battle left halfway is the one the server gives back. So every test here
 * begins by putting that right (`rest`), and what a battle leaves behind has
 * tests of its own (growth.spec.ts).
 */

import { expect, test } from "@playwright/test";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

import {
  closeArenas,
  failOnPageErrors,
  leadMonster,
  rest,
  standAt,
  storedPosition,
} from "./helpers.js";

interface BattleView {
  id: string;
  turn: number;
  status: "ongoing" | "won" | "lost";
  player: { hp: number; maxHp: number; moves: { id: string }[] };
  enemy: { hp: number; maxHp: number };
}

function battle(page: Page): Locator {
  return page.getByRole("region", { name: "バトル" });
}

async function health(page: Page, side: "こちら" | "あいて"): Promise<number> {
  const bar = battle(page).getByRole("progressbar", { name: `${side}の HP` });
  return Number(await bar.getAttribute("value"));
}

/**
 * From the grass at (5,1) into a new battle, the way a player gets there: with
 * a rested monster, and no battle left over from the test before.
 */
async function startBattle(page: Page, request: APIRequestContext): Promise<string> {
  await rest(request);
  await standAt(request, 5, 1);
  await page.goto("/");
  await page.getByRole("button", { name: "草むらを調べる" }).click();
  await expect(page).toHaveURL(/#\/battles\/[0-9a-f-]+$/);
  await expect(battle(page).getByRole("group", { name: "技" })).toBeVisible();
  return page.url().split("#/battles/")[1] ?? "";
}

async function fetchBattle(request: APIRequestContext, id: string): Promise<BattleView> {
  const response = await request.get(`/api/battles/${id}`);
  expect(response.ok(), "GET the battle").toBe(true);
  return (await response.json()) as BattleView;
}

test.describe("a battle", () => {
  test.beforeEach(({ page }) => {
    failOnPageErrors(page);
  });

  test.afterAll(async ({ request }) => {
    await closeArenas(request);
  });

  test("can only be started in the grass, once the step there is saved", async ({
    page,
    request,
  }) => {
    await rest(request);
    await standAt(request, 4, 1);
    await page.goto("/");
    const search = page.getByRole("button", { name: "草むらを調べる" });
    await expect(search).toBeDisabled();

    await page.keyboard.press("ArrowRight"); // onto the grass at (5,1)
    await expect(page.getByRole("region", { name: "マップ" }).getByRole("status")).toHaveText(
      "保存済み",
    );
    await expect(search).toBeEnabled();
  });

  test("starts with a rested monster and a wild one at full health, both drawn", async ({
    page,
    request,
  }) => {
    const id = await startBattle(page, request);
    const stored = await fetchBattle(request, id);
    // The battle is this monster's: the list of monsters says which one it is in.
    expect((await leadMonster(request)).battleId).toBe(id);

    expect(await health(page, "こちら")).toBe(stored.player.maxHp);
    expect(await health(page, "あいて")).toBe(stored.enemy.maxHp);
    await expect(battle(page).getByRole("group", { name: "あいて" }).locator("strong")).toHaveText(
      /^やせいの /,
    );
    // Both pictures are skins fetched from the API and drawn by <Sprite>.
    for (const side of ["こちら", "あいて"]) {
      await expect(
        battle(page).getByRole("group", { name: side }).locator("svg rect").first(),
      ).toBeAttached();
    }
    // What the server keeps to itself is not in what it sends.
    expect(JSON.stringify(stored)).not.toContain("attack");
  });

  test("is played to its end, one move at a time", async ({ page, request }) => {
    await startBattle(page, request);
    const before = await leadMonster(request);
    const log = battle(page).getByRole("list", { name: "ログ" }).getByRole("listitem");
    const result = battle(page).getByRole("status");
    const firstMove = battle(page).getByRole("group", { name: "技" }).getByRole("button").first();

    let mine = await health(page, "こちら");
    let theirs = await health(page, "あいて");

    // Every hit does at least 1, so this is more turns than any battle can take.
    for (let turn = 0; turn < 80 && !(await result.isVisible()); turn++) {
      const lines = await log.count();
      await firstMove.click();
      await expect
        .poll(async () => (await log.count()) > lines, { message: "the turn was played" })
        .toBe(true);

      const [nowMine, nowTheirs] = [await health(page, "こちら"), await health(page, "あいて")];
      // Health only goes down, and the player's move always lands.
      expect(nowMine).toBeLessThanOrEqual(mine);
      expect(nowTheirs).toBeLessThan(theirs);
      [mine, theirs] = [nowMine, nowTheirs];
    }

    await expect(result).toHaveText(/^(勝った！|負けてしまった…)$/);
    const won = (await result.textContent()) === "勝った！";
    expect(won ? theirs : mine).toBe(0);
    expect(won ? mine : theirs).toBeGreaterThan(0);
    // Nothing left to choose once it is over.
    await expect(battle(page).getByRole("group", { name: "技" })).toHaveCount(0);

    // A win leaves the player on the grass. A loss has put them back at the
    // start, and the map shows whichever the server says.
    const here = won ? { x: 5, y: 1 } : { x: 1, y: 1 };
    await battle(page).getByRole("link", { name: "マップに戻る" }).click();
    await expect(page.getByRole("region", { name: "マップ" }).getByText("現在地:")).toContainText(
      `(${here.x}, ${here.y})`,
    );
    expect(await storedPosition(request)).toEqual(here);

    // And the monster has what the battle left it with.
    const after = await leadMonster(request);
    expect(after.battleId).toBeNull();
    expect(after.hp).toBe(won ? after.maxHp - (before.maxHp - mine) : after.maxHp);
    expect(after.exp > before.exp).toBe(won);
  });

  test("is still there after a reload, exactly as it stood", async ({ page, request }) => {
    const id = await startBattle(page, request);
    await battle(page).getByRole("group", { name: "技" }).getByRole("button").first().click();
    await expect(
      battle(page).getByRole("list", { name: "ログ" }).getByRole("listitem"),
    ).not.toHaveCount(0);
    const before = await fetchBattle(request, id);

    await page.reload();
    await expect(battle(page).getByRole("progressbar", { name: "こちらの HP" })).toBeVisible();
    expect(await health(page, "こちら")).toBe(before.player.hp);
    expect(await health(page, "あいて")).toBe(before.enemy.hp);
    // The log is this visit's, not the battle's.
    await expect(
      battle(page).getByRole("list", { name: "ログ" }).getByRole("listitem"),
    ).toHaveCount(0);
  });

  test("catches up when the turn was already played somewhere else", async ({ page, request }) => {
    const id = await startBattle(page, request);

    // Another tab, as far as this page can tell.
    const seen = await fetchBattle(request, id);
    const elsewhere = await request.post(`/api/battles/${id}/turn`, {
      data: { moveId: seen.player.moves[0]?.id, turn: seen.turn },
    });
    expect(elsewhere.ok()).toBe(true);
    const actual = await fetchBattle(request, id);
    test.skip(actual.status !== "ongoing", "the battle ended in a single turn");

    await battle(page).getByRole("group", { name: "技" }).getByRole("button").first().click();
    await expect(battle(page).getByRole("alert")).toHaveText("技を出せなかった（stale_turn）");
    // The move was refused, and the screen now shows what the server has.
    await expect
      .poll(() => health(page, "あいて"), { message: "the screen caught up" })
      .toBe(actual.enemy.hp);
    expect(await health(page, "こちら")).toBe(actual.player.hp);
    expect((await fetchBattle(request, id)).turn).toBe(actual.turn);
  });

  test("says so when the battle does not exist", async ({ page }) => {
    await page.goto("/#/battles/00000000-0000-0000-0000-000000000000");
    await expect(battle(page).getByRole("alert")).toHaveText(
      "バトルを読み込めなかった（not_found）",
    );
    await expect(battle(page).getByRole("link", { name: "マップに戻る" })).toBeVisible();
  });
});
