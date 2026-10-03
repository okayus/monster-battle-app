/**
 * What the player wears: chosen on the dressing screen, drawn on the map.
 *
 * The skins these tests wear are bars. Each part of a test skin is one row of
 * one colour, on a row that says which skin and which part it is, so "the hair
 * is the other skin's" can be read off the page as "the hair's bar is on that
 * row":
 *
 *            body  shirt  pants  shoes  hair
 *   skin A     0     1      2      3     4      y of the bar
 *   skin B     8     9     10     11    12
 */

import { expect, test } from "@playwright/test";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { failOnPageErrors } from "./helpers.js";

const SLOTS = ["body", "shirt", "pants", "shoes", "hair"] as const;
type Slot = (typeof SLOTS)[number];

interface PaletteEntry {
  id: string;
  hex: string;
}

interface Appearance {
  skinId: string;
  parts: Partial<Record<Slot, string>>;
  colours: PaletteEntry[];
}

const DEFAULT_LOOK: Appearance = { skinId: "player-default", parts: {}, colours: [] };

/** A's colours, by the part each one paints. `spare` is in the palette and on no cell. */
const PALETTE_A: PaletteEntry[] = [
  { id: "skin", hex: "#e8b98a" },
  { id: "shirt", hex: "#3f7bd6" },
  { id: "pants", hex: "#2f3a56" },
  { id: "shoes", hex: "#7a4a2a" },
  { id: "hair", hex: "#5a3921" },
  { id: "spare", hex: "#00ff00" },
];

/** B paints its hair with a colour A does not have, and shares "skin" with A in another shade. */
const PALETTE_B: PaletteEntry[] = [
  { id: "skin", hex: "#c68642" },
  { id: "shirt", hex: "#ffffff" },
  { id: "pants", hex: "#111111" },
  { id: "shoes", hex: "#333333" },
  { id: "hat", hex: "#aa2200" },
];

const RUN = Date.now().toString(36);

/** Saves a bar skin through the API, the way the editor would, and returns its id. */
async function drawBars(
  request: APIRequestContext,
  name: string,
  palette: PaletteEntry[],
  firstRow: number,
): Promise<string> {
  const response = await request.post("/api/skins", {
    data: {
      formatVersion: 1,
      name: `${name}-${RUN}`,
      palette,
      parts: SLOTS.map((slot, i) => ({
        slot,
        frames: [
          {
            durationMs: 120,
            cells: [
              [0, (firstRow + i) * 16],
              [i + 1, 16],
              [0, (15 - firstRow - i) * 16],
            ].filter(([, length]) => length !== 0),
          },
        ],
      })),
    },
  });
  expect(response.status(), `POST /api/skins (${name})`).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function wear(request: APIRequestContext, appearance: Appearance): Promise<void> {
  const response = await request.put("/api/appearance", { data: appearance });
  expect(response.ok(), "PUT /api/appearance").toBe(true);
}

async function worn(request: APIRequestContext): Promise<Appearance> {
  const response = await request.get("/api/appearance");
  expect(response.ok(), "GET /api/appearance").toBe(true);
  return (await response.json()) as Appearance;
}

function wardrobe(page: Page): Locator {
  return page.getByRole("region", { name: "きがえ" });
}

/** Which row each part's bar is on, in draw order: what a sprite on the page is showing. */
async function rows(sprite: Locator): Promise<Record<string, number>> {
  return sprite.locator("g[data-part]").evaluateAll((groups) => {
    const found: Record<string, number> = {};
    for (const group of groups) {
      const rect = group.querySelector("rect");
      found[(group as SVGGElement).dataset.part ?? ""] = Number(rect?.getAttribute("y"));
    }
    return found;
  });
}

/** The colour a part's bar is actually painted in, after CSS has had its say. */
function fill(sprite: Locator, slot: Slot): Locator {
  return sprite.locator(`g[data-part="${slot}"] rect`).first();
}

const ROWS_A = { body: 0, shirt: 1, pants: 2, shoes: 3, hair: 4 };
const ROWS_B = { body: 8, shirt: 9, pants: 10, shoes: 11, hair: 12 };

test.describe("what the player wears", () => {
  let a = "";
  let b = "";

  test.beforeAll(async ({ request }) => {
    a = await drawBars(request, "しましまA", PALETTE_A, 0);
    b = await drawBars(request, "しましまB", PALETTE_B, 8);
  });

  test.beforeEach(async ({ page, request }) => {
    failOnPageErrors(page);
    await wear(request, DEFAULT_LOOK);
  });

  /** Opens the dressing screen and waits until the look that is worn has been drawn. */
  async function openWardrobe(page: Page): Promise<Locator> {
    await page.goto("/#/look");
    const preview = wardrobe(page).locator("[data-look]");
    await expect(preview.locator("svg rect").first()).toBeAttached();
    return preview;
  }

  async function save(page: Page): Promise<void> {
    await wardrobe(page).getByRole("button", { name: "この見た目にする" }).click();
    await expect(wardrobe(page).getByRole("status")).toHaveText("保存した");
  }

  /** The player on the map, once the look has replaced the plain marker. */
  async function onTheMap(page: Page): Promise<Locator> {
    const player = page.getByRole("region", { name: "マップ" }).locator("[data-player]");
    await expect(player.locator("svg rect").first()).toBeAttached();
    return player;
  }

  test("starts as the default skin, drawn on the map where the marker was", async ({ page }) => {
    await page.goto("/");
    const player = await onTheMap(page);

    // All five parts of the skin that ships with the game, each with something on it.
    await expect(player.locator("g[data-part]")).toHaveCount(SLOTS.length);
    for (const slot of SLOTS) {
      await expect(player.locator(`g[data-part="${slot}"] rect`).first()).toBeAttached();
    }
    // It is on a tile, like the marker it replaces: the map tests find the player this way.
    await expect(page.locator("[data-tile] > [data-player]")).toHaveCount(1);
  });

  test("is fetched once, not again for every step", async ({ page }) => {
    const asked: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/appearance" || path.startsWith("/api/skins/")) asked.push(path);
    });

    await page.goto("/");
    await onTheMap(page);
    const map = page.getByRole("region", { name: "マップ" });
    for (const key of ["ArrowRight", "ArrowDown", "ArrowUp", "ArrowLeft"]) {
      await page.keyboard.press(key);
    }
    await expect(map.getByRole("status")).toHaveText("保存済み");
    // The marker is a new element on every tile; what it draws must not be.
    await onTheMap(page);
    expect(asked).toEqual(["/api/appearance", "/api/skins/player-default"]);
  });

  test("wears the skin chosen on the dressing screen, on the map and after a reload", async ({
    page,
    request,
  }) => {
    // A saved skin says where it can be worn.
    await page.goto(`/#/skins/${a}`);
    await page
      .getByRole("region", { name: "保存されたスキン" })
      .getByRole("link", { name: "きがえ" })
      .click();
    await expect(page).toHaveURL(/#\/look$/);
    const preview = wardrobe(page).locator("[data-look]");
    await expect(preview.locator("svg rect").first()).toBeAttached();

    await wardrobe(page).getByLabel("着るスキン").selectOption(a);
    await expect.poll(() => rows(preview)).toEqual(ROWS_A);
    // Trying it on is not wearing it: nothing is stored until the button is pressed.
    expect(await worn(request)).toEqual(DEFAULT_LOOK);

    await save(page);
    expect(await worn(request)).toEqual({ skinId: a, parts: {}, colours: [] });

    await wardrobe(page).getByRole("link", { name: "マップ" }).click();
    expect(await rows(await onTheMap(page))).toEqual(ROWS_A);
    await page.reload();
    expect(await rows(await onTheMap(page))).toEqual(ROWS_A);

    // And the dressing screen opens on what is worn now.
    await openWardrobe(page);
    await expect(wardrobe(page).getByLabel("着るスキン")).toHaveValue(a);
  });

  test("stops saying it is saved once something is changed", async ({ page }) => {
    await openWardrobe(page);
    await wardrobe(page).getByLabel("着るスキン").selectOption(a);
    await save(page);
    await wardrobe(page).getByLabel("着るスキン").selectOption(b);
    await expect(wardrobe(page).getByRole("status")).toHaveText("");
  });

  test("offers the colours the look is painted with, and no others", async ({ page, request }) => {
    await wear(request, { skinId: a, parts: {}, colours: [] });
    await openWardrobe(page);

    const colours = wardrobe(page).getByRole("group", { name: "色" });
    await expect(colours.locator('input[type="color"]')).toHaveCount(5);
    for (const id of ["skin", "shirt", "pants", "shoes", "hair"]) {
      await expect(colours.getByLabel(`${id} の色`)).toBeVisible();
    }
    // In A's palette, on none of its cells: there would be nothing to see.
    await expect(colours.getByLabel("spare の色")).toHaveCount(0);
  });

  test("dyes a colour, and leaves the skin as it was drawn", async ({ page, request }) => {
    await wear(request, { skinId: a, parts: {}, colours: [] });
    const skinsBefore = ((await (await request.get("/api/skins")).json()) as unknown[]).length;
    const preview = await openWardrobe(page);
    await expect(fill(preview, "hair")).toHaveCSS("fill", "rgb(90, 57, 33)");

    await wardrobe(page).getByLabel("hair の色").fill("#cc3344");
    await expect(fill(preview, "hair")).toHaveCSS("fill", "rgb(204, 51, 68)");
    // Only what is painted with that id changes.
    await expect(fill(preview, "shirt")).toHaveCSS("fill", "rgb(63, 123, 214)");
    // What will be sent is on the screen, and it is a colour, not a drawing.
    await expect(wardrobe(page).locator("[data-recipe]")).toHaveText(
      JSON.stringify({ skinId: a, parts: {}, colours: [{ id: "hair", hex: "#cc3344" }] }),
    );

    await save(page);
    expect((await worn(request)).colours).toEqual([{ id: "hair", hex: "#cc3344" }]);

    // The skin is still the one that was drawn, and it is still the only one.
    const stored = (await (await request.get(`/api/skins/${a}`)).json()) as {
      palette: PaletteEntry[];
    };
    expect(stored.palette).toEqual(PALETTE_A);
    expect(((await (await request.get("/api/skins")).json()) as unknown[]).length).toBe(
      skinsBefore,
    );

    await page.goto("/");
    await expect(fill(await onTheMap(page), "hair")).toHaveCSS("fill", "rgb(204, 51, 68)");
    await page.reload();
    await expect(fill(await onTheMap(page), "hair")).toHaveCSS("fill", "rgb(204, 51, 68)");

    // Back on the dressing screen the colour is the chosen one, until it is given up.
    const again = await openWardrobe(page);
    await expect(wardrobe(page).getByLabel("hair の色")).toHaveValue("#cc3344");
    await wardrobe(page).getByRole("button", { name: "描いた色に戻す" }).click();
    await expect(fill(again, "hair")).toHaveCSS("fill", "rgb(90, 57, 33)");
    await expect(wardrobe(page).getByRole("button", { name: "描いた色に戻す" })).toBeDisabled();
  });

  test("takes a part from another skin, with the colours that part is painted in", async ({
    page,
    request,
  }) => {
    await wear(request, { skinId: a, parts: {}, colours: [] });
    const preview = await openWardrobe(page);
    const parts = wardrobe(page).getByRole("group", { name: "パーツ" });
    const colours = wardrobe(page).getByRole("group", { name: "色" });

    await parts.getByLabel("かみ").selectOption(b);
    // B's hair, on B's row, over everything else of A's.
    await expect.poll(() => rows(preview)).toEqual({ ...ROWS_A, hair: ROWS_B.hair });
    await expect(fill(preview, "hair")).toHaveCSS("fill", "rgb(170, 34, 0)");

    // B's hair is painted with "hat". A's "hair" is not on anything any more.
    await expect(colours.getByLabel("hat の色")).toBeVisible();
    await expect(colours.getByLabel("hair の色")).toHaveCount(0);

    await colours.getByLabel("hat の色").fill("#101010");
    await expect(fill(preview, "hair")).toHaveCSS("fill", "rgb(16, 16, 16)");

    await save(page);
    expect(await worn(request)).toEqual({
      skinId: a,
      parts: { hair: b },
      colours: [{ id: "hat", hex: "#101010" }],
    });

    await page.goto("/");
    const player = await onTheMap(page);
    expect(await rows(player)).toEqual({ ...ROWS_A, hair: ROWS_B.hair });
    await expect(fill(player, "hair")).toHaveCSS("fill", "rgb(16, 16, 16)");

    // The worn skin's own part is one choice away.
    await openWardrobe(page);
    await expect(parts.getByLabel("かみ")).toHaveValue(b);
    await parts.getByLabel("かみ").selectOption("");
    await expect.poll(() => rows(wardrobe(page).locator("[data-look]"))).toEqual(ROWS_A);
  });

  test("treats a colour as a role: it follows the id onto whichever skin's part has it", async ({
    page,
    request,
  }) => {
    await wear(request, { skinId: a, parts: {}, colours: [] });
    const preview = await openWardrobe(page);
    const parts = wardrobe(page).getByRole("group", { name: "パーツ" });

    // Both skins paint their body with "skin", each in its own shade.
    await expect(fill(preview, "body")).toHaveCSS("fill", "rgb(232, 185, 138)");
    await parts.getByLabel("からだ").selectOption(b);
    await expect(fill(preview, "body")).toHaveCSS("fill", "rgb(198, 134, 66)");

    // One choice of colour for "skin" …
    await wardrobe(page).getByLabel("skin の色").fill("#00aa00");
    await expect(fill(preview, "body")).toHaveCSS("fill", "rgb(0, 170, 0)");
    // … holds for the other skin's body as well.
    await parts.getByLabel("からだ").selectOption("");
    await expect.poll(() => rows(preview)).toEqual(ROWS_A);
    await expect(fill(preview, "body")).toHaveCSS("fill", "rgb(0, 170, 0)");
  });

  test("sends only the colours that apply, and keeps the others for when they do again", async ({
    page,
    request,
  }) => {
    await wear(request, { skinId: a, parts: {}, colours: [] });
    const preview = await openWardrobe(page);
    const parts = wardrobe(page).getByRole("group", { name: "パーツ" });

    await wardrobe(page).getByLabel("hair の色").fill("#cc3344");
    // With B's hair on, nothing is painted with A's "hair". The server would
    // refuse a recipe that still named it.
    await parts.getByLabel("かみ").selectOption(b);
    await expect(wardrobe(page).locator("[data-recipe]")).toHaveText(
      JSON.stringify({ skinId: a, parts: { hair: b }, colours: [] }),
    );
    await save(page);
    expect(await worn(request)).toEqual({ skinId: a, parts: { hair: b }, colours: [] });

    // The choice was only left out, not forgotten.
    await parts.getByLabel("かみ").selectOption("");
    await expect(fill(preview, "hair")).toHaveCSS("fill", "rgb(204, 51, 68)");
  });

  test("says so when the server refuses, and the look stays as it was", async ({
    page,
    request,
  }) => {
    await openWardrobe(page);
    await wardrobe(page).getByLabel("着るスキン").selectOption(a);

    // A skin that stopped existing between choosing it and saving.
    await page.route("**/api/appearance", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: { kind: "unknown_skin", skinId: a } }),
      });
    });
    await wardrobe(page).getByRole("button", { name: "この見た目にする" }).click();

    await expect(wardrobe(page).getByRole("alert")).toHaveText("保存できなかった（unknown_skin）");
    await expect(wardrobe(page).getByRole("status")).toHaveText("");
    expect(await worn(request)).toEqual(DEFAULT_LOOK);
  });
});
