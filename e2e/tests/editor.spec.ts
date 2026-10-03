/**
 * The skin editor, driven the way a person would: a mouse on the canvas,
 * typing in the fields.
 *
 * Canvas cells are addressed as (x, y). Each one carries the palette number it
 * holds in `data-colour`, which is what the counts below read: 0 is empty, and
 * with the default palette 1 is "skin", 2 is "hair", 3 is "shirt".
 */

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { failOnPageErrors, stroke } from "./helpers.js";

function editor(page: Page): Locator {
  return page.getByRole("region", { name: "スキンエディタ" });
}

function canvas(page: Page): Locator {
  return editor(page).getByRole("group", { name: "キャンバス" });
}

function cell(page: Page, x: number, y: number): Locator {
  return canvas(page).getByRole("button", { name: `${x},${y}`, exact: true });
}

function part(page: Page, name: string): Locator {
  return editor(page)
    .getByRole("group", { name: "パーツ" })
    .getByRole("button", { name, exact: true });
}

function colour(page: Page, id: string): Locator {
  return editor(page)
    .getByRole("group", { name: "色", exact: true })
    .getByRole("button", { name: id, exact: true });
}

function frame(page: Page, number: number): Locator {
  return editor(page)
    .getByRole("group", { name: "コマ", exact: true })
    .getByRole("button", { name: `コマ ${number}`, exact: true });
}

/** How many cells of the part on the canvas hold each palette number. */
async function painted(page: Page): Promise<Record<string, number>> {
  // `evaluateAll` does not wait for anything. Counting cells of a canvas that
  // is still mounting would report "nothing painted" and be believed.
  await expect(canvas(page).getByRole("button")).toHaveCount(16 * 16);
  return canvas(page)
    .getByRole("button")
    .evaluateAll((cells) => {
      const counts: Record<string, number> = {};
      for (const one of cells) {
        const held = (one as HTMLElement).dataset.colour ?? "0";
        if (held !== "0") counts[held] = (counts[held] ?? 0) + 1;
      }
      return counts;
    });
}

/**
 * Waits until the part on the canvas holds exactly these: palette number, and
 * how many cells of it.
 */
async function expectPainted(page: Page, counts: Record<string, number>): Promise<void> {
  await expect.poll(() => painted(page)).toEqual(counts);
}

/** Where the rects of a drawn sprite are: enough to tell two frames apart. */
async function drawnAt(sprite: Locator): Promise<string> {
  return sprite
    .locator("rect")
    .evaluateAll((rects) =>
      rects.map((rect) => `${rect.getAttribute("x")},${rect.getAttribute("y")}`).join(" "),
    );
}

/** Watches a sprite for a while and returns every distinct picture it showed. */
async function picturesShown(page: Page, sprite: Locator): Promise<Set<string>> {
  const seen = new Set<string>();
  for (let n = 0; n < 25; n++) {
    seen.add(await drawnAt(sprite));
    await page.waitForTimeout(40);
  }
  return seen;
}

/** Colour on the body, then on the hair: 4 cells of skin, 6 cells of hair. */
async function drawSomething(page: Page): Promise<void> {
  await colour(page, "skin").click();
  await stroke(page, cell(page, 6, 4), cell(page, 9, 4));
  await part(page, "かみ").click();
  await colour(page, "hair").click();
  await stroke(page, cell(page, 5, 2), cell(page, 10, 2));
}

test.describe("the skin editor", () => {
  test.beforeEach(async ({ page }) => {
    failOnPageErrors(page);
    await page.goto("/#/editor");
    await expect(canvas(page).getByRole("button")).toHaveCount(16 * 16);
  });

  test("starts empty, on the body, and cannot save a skin with no name", async ({ page }) => {
    await expectPainted(page, {});
    await expect(part(page, "からだ")).toHaveAttribute("aria-pressed", "true");
    await expect(editor(page).getByText("コマ（1 / 8）")).toBeVisible();
    await expect(editor(page).getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  });

  test("paints each part on its own, with the others showing through", async ({ page }) => {
    await colour(page, "skin").click();
    await stroke(page, cell(page, 6, 3), cell(page, 9, 3));
    await expectPainted(page, { "1": 4 });

    // The shirt starts empty, and the body is visible behind it.
    await part(page, "ふく").click();
    await expectPainted(page, {});
    const ghost = editor(page).locator("[data-ghost]");
    await expect(ghost.locator("rect").first()).toBeAttached();

    await colour(page, "shirt").click();
    await stroke(page, cell(page, 4, 6), cell(page, 11, 6));
    await expectPainted(page, { "3": 8 });

    const showOthers = editor(page).getByLabel("ほかのパーツを透かして見る");
    await showOthers.uncheck();
    await expect(ghost).toHaveCount(0);
    await showOthers.check();
    await expect(ghost).toHaveCount(1);

    // Painting the shirt did nothing to the body.
    await part(page, "からだ").click();
    await expectPainted(page, { "1": 4 });
  });

  test("adds a colour without touching the drawing", async ({ page }) => {
    await drawSomething(page);
    const adding = editor(page).getByRole("group", { name: "色を足す" });

    // A name that is taken is refused, in words.
    await adding.getByLabel("足す色の名前").fill("hair");
    await adding.getByRole("button", { name: "足す" }).click();
    await expect(adding.getByRole("alert")).toHaveText("「hair」はもうある");

    // So is one the format would not accept.
    await adding.getByLabel("足す色の名前").fill("My Shoes");
    await adding.getByRole("button", { name: "足す" }).click();
    await expect(adding.getByRole("alert")).toContainText("半角の小文字");

    await adding.getByLabel("足す色の名前").fill("shoes");
    await adding.getByLabel("足す色", { exact: true }).fill("#7a4a2a");
    await adding.getByRole("button", { name: "足す" }).click();
    await expect(adding.getByRole("alert")).toHaveCount(0);
    // The new colour is in hand, and the next name is suggested.
    await expect(colour(page, "shoes")).toHaveAttribute("aria-pressed", "true");
    await expect(adding.getByLabel("足す色の名前")).toHaveValue("color-1");
    // The hair that was drawn before is as it was.
    await expectPainted(page, { "2": 6 });
  });

  test("remakes a colour everywhere it is used, after saying where", async ({ page }) => {
    // The hair colour on two parts: 6 cells of hair, 2 cells on the body.
    await drawSomething(page);
    await part(page, "からだ").click();
    await cell(page, 7, 5).click();
    await cell(page, 8, 5).click();

    const remaking = editor(page).getByRole("group", { name: "色を作り直す" });
    await expect(remaking.locator("[data-usage]")).toContainText("からだ・かみの 8 マス");
    const apply = remaking.getByRole("button", { name: /作り直す$/ });
    await expect(apply).toBeDisabled();

    await remaking.getByLabel("作り直す色").fill("#222222");
    // Choosing is not doing: nothing changes until the button is pressed.
    await expect(cell(page, 7, 5)).toHaveCSS("background-color", "rgb(90, 57, 33)");
    await apply.click();

    await expect(cell(page, 7, 5)).toHaveCSS("background-color", "rgb(34, 34, 34)");
    await expect(colour(page, "hair")).toHaveCSS("background-color", "rgb(34, 34, 34)");
    await part(page, "かみ").click();
    await expect(cell(page, 5, 2)).toHaveCSS("background-color", "rgb(34, 34, 34)");
  });

  test("adds, times and removes frames", async ({ page }) => {
    await colour(page, "skin").click();
    await stroke(page, cell(page, 6, 4), cell(page, 9, 4));
    const duration = editor(page).getByLabel("このコマの長さ（ミリ秒）");

    // A new frame is a copy of the one it was added from.
    await editor(page).getByRole("button", { name: "コマを足す" }).click();
    await expect(editor(page).getByText("コマ（2 / 8）")).toBeVisible();
    await expect(frame(page, 2)).toHaveAttribute("aria-pressed", "true");
    await expectPainted(page, { "1": 4 });

    // Painting and timing it leaves the first frame alone.
    await cell(page, 2, 10).click();
    await duration.fill("300");
    await frame(page, 1).click();
    await expectPainted(page, { "1": 4 });
    await expect(duration).toHaveValue("120");

    // Add a third after the first, then remove it: the selection lands on the
    // frame that was second, and the field has to show *that* frame's time.
    await editor(page).getByRole("button", { name: "コマを足す" }).click();
    await expect(editor(page).getByText("コマ（3 / 8）")).toBeVisible();
    await editor(page).getByRole("button", { name: "このコマを消す" }).click();
    await expect(editor(page).getByText("コマ（2 / 8）")).toBeVisible();
    await expect(duration).toHaveValue("300");
    await expectPainted(page, { "1": 5 });

    // On the way to a new number the field can be empty; the frame keeps its time.
    await duration.fill("");
    await expect(duration).toHaveValue("");
    await frame(page, 1).click();
    await frame(page, 2).click();
    await expect(duration).toHaveValue("300");
  });

  test("plays the frames in the preview", async ({ page }) => {
    await colour(page, "skin").click();
    await cell(page, 4, 4).click();
    await editor(page).getByRole("button", { name: "コマを足す" }).click();
    await cell(page, 10, 10).click();

    const preview = editor(page).locator("[data-preview]");
    const still = await drawnAt(preview);

    await editor(page).getByRole("button", { name: "再生" }).click();
    expect((await picturesShown(page, preview)).size).toBe(2);

    await editor(page).getByRole("button", { name: "止める" }).click();
    await expect.poll(() => drawnAt(preview)).toBe(still);
  });

  test("tries parts and colours on without changing the drawing", async ({ page }) => {
    await drawSomething(page);
    const preview = editor(page).locator("[data-preview]");
    const wornParts = () =>
      preview
        .locator("g")
        .evaluateAll((groups) =>
          groups
            .filter((group) => group.querySelector("rect") !== null)
            .map((group) => (group as SVGGElement).dataset.part),
        );

    expect(await wornParts()).toEqual(["body", "hair"]);
    const wearing = editor(page).getByRole("group", { name: "着るパーツ" });
    await wearing.getByLabel("かみ").uncheck();
    expect(await wornParts()).toEqual(["body"]);
    await wearing.getByLabel("かみ").check();

    // Trying a colour sets a CSS variable around the sprite. The cells on the
    // canvas, which show what is actually drawn, do not move.
    const hairInPreview = preview.locator('g[data-part="hair"] rect').first();
    await editor(page).getByLabel("hair を試す").fill("#ff0000");
    await expect(hairInPreview).toHaveCSS("fill", "rgb(255, 0, 0)");
    await expect(cell(page, 5, 2)).toHaveCSS("background-color", "rgb(90, 57, 33)");

    await editor(page).getByRole("button", { name: "試した色を戻す" }).click();
    await expect(hairInPreview).toHaveCSS("fill", "rgb(90, 57, 33)");
  });

  test("keeps the drawing while another screen is open", async ({ page }) => {
    await drawSomething(page);
    await page.getByRole("navigation").getByRole("link", { name: "マップ" }).click();
    await expect(page.getByRole("region", { name: "マップ" })).toBeVisible();
    await page.getByRole("navigation").getByRole("link", { name: "スキンエディタ" }).click();
    await expectPainted(page, { "2": 6 });
  });

  test("saves, shows the server's copy playing, and opens it again", async ({ page, request }) => {
    // Two frames that differ, so there is something to play.
    await drawSomething(page);
    await editor(page).getByRole("button", { name: "コマを足す" }).click();
    await cell(page, 1, 12).click();
    await editor(page).getByLabel("このコマの長さ（ミリ秒）").fill("300");

    await editor(page).getByLabel("スキンの名前").fill("テストのスキン");
    await editor(page).getByRole("button", { name: "保存", exact: true }).click();
    await expect(page).toHaveURL(/#\/skins\/[0-9a-f-]+$/);
    const id = page.url().split("#/skins/")[1] ?? "";

    // What the server stored is what was drawn.
    const source = (await (await request.get(`/api/skins/${id}/source`)).json()) as {
      name: string;
      palette: { id: string }[];
      parts: { slot: string; frames: { durationMs: number }[] }[];
    };
    expect(source.name).toBe("テストのスキン");
    expect(source.parts.map((one) => `${one.slot}:${one.frames.length}`)).toEqual([
      "body:2",
      "shirt:2",
      "pants:2",
      "shoes:2",
      "hair:2",
    ]);
    expect(source.parts[0]?.frames.map((one) => one.durationMs)).toEqual([120, 300]);

    // The saved view is drawn from the server's answer, and it moves.
    const saved = page.getByRole("region", { name: "保存されたスキン" });
    await expect(saved.locator("svg rect").first()).toBeAttached();
    expect((await picturesShown(page, saved.locator("svg"))).size).toBe(2);

    // Starting over takes two presses…
    await editor(page).getByRole("button", { name: "新しく描く" }).click();
    expect(await painted(page)).not.toEqual({});
    await editor(page).getByRole("button", { name: "本当に全部消す" }).click();
    await part(page, "かみ").click();
    await expectPainted(page, {});
    await expect(editor(page).getByLabel("スキンの名前")).toHaveValue("");

    // …and the saved skin comes back as it was drawn.
    await saved.getByRole("button", { name: "このスキンをエディタで開く" }).click();
    await expect(editor(page).getByLabel("スキンの名前")).toHaveValue("テストのスキン");
    await expect(editor(page).getByText("コマ（2 / 8）")).toBeVisible();
    await part(page, "かみ").click();
    await expectPainted(page, { "2": 6 });
  });
});
