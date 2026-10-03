/**
 * What the tests share.
 *
 * Preconditions are set through the API, not by clicking. A test about battles
 * should not fail because walking is broken; walking has tests of its own.
 */

import { expect } from "@playwright/test";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

export interface Position {
  x: number;
  y: number;
}

/** Puts the player somewhere, the way an earlier visit would have left them. */
export async function standAt(request: APIRequestContext, x: number, y: number): Promise<void> {
  const response = await request.put("/api/save", {
    data: { mapId: "start", position: { x, y } },
  });
  expect(response.ok(), `PUT /api/save to (${x}, ${y})`).toBe(true);
}

/** Where the server has the player. */
export async function storedPosition(request: APIRequestContext): Promise<Position> {
  const response = await request.get("/api/save");
  expect(response.ok(), "GET /api/save").toBe(true);
  const save = (await response.json()) as { position: Position };
  return save.position;
}

async function centreOf(locator: Locator): Promise<Position> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("the element is not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * A real mouse stroke: press on one element, drag to another, release. The
 * drag goes through enough points that nothing in between is skipped.
 */
export async function stroke(page: Page, from: Locator, to: Locator): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const start = await centreOf(from);
  const end = await centreOf(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 32 });
  await page.mouse.up();
}

/**
 * Fails the test if the page throws while it runs: an exception nobody caught,
 * which the app would otherwise swallow and the test would never see.
 */
export function failOnPageErrors(page: Page): void {
  page.on("pageerror", (error) => {
    throw new Error(`the page threw: ${error.message}`);
  });
}

// ---------------------------------------------------------------------------
// Skins and looks
// ---------------------------------------------------------------------------

export const SLOTS = ["body", "shirt", "pants", "shoes", "hair"] as const;
export type Slot = (typeof SLOTS)[number];

export interface PaletteEntry {
  id: string;
  hex: string;
}

export interface Appearance {
  skinId: string;
  parts: Partial<Record<Slot, string>>;
  colours: PaletteEntry[];
}

/** What a player who never chose anything looks like. */
export const DEFAULT_LOOK: Appearance = { skinId: "player-default", parts: {}, colours: [] };

/**
 * Saves a skin made of bars through the API, the way the editor would, and
 * returns its id. Each part is one row of one colour: part n is painted with
 * the palette's n-th colour, on row `firstRow + n`. Which skin a part on the
 * page came from can then be read off as which row its bar is on.
 */
export async function drawBars(
  request: APIRequestContext,
  name: string,
  palette: PaletteEntry[],
  firstRow: number,
): Promise<string> {
  const response = await request.post("/api/skins", {
    data: {
      formatVersion: 1,
      name,
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

/** Dresses the player, the way a visit to the dressing screen would have. */
export async function wear(request: APIRequestContext, appearance: Appearance): Promise<void> {
  const response = await request.put("/api/appearance", { data: appearance });
  expect(response.ok(), "PUT /api/appearance").toBe(true);
}

/** What the server says the player is wearing. */
export async function worn(request: APIRequestContext): Promise<Appearance> {
  const response = await request.get("/api/appearance");
  expect(response.ok(), "GET /api/appearance").toBe(true);
  return (await response.json()) as Appearance;
}

/** Which row each part's first rect is on, in draw order: what a sprite on the page is showing. */
export async function rows(sprite: Locator): Promise<Record<string, number>> {
  return sprite.locator("g[data-part]").evaluateAll((groups) => {
    const found: Record<string, number> = {};
    for (const group of groups) {
      const rect = group.querySelector("rect");
      found[(group as SVGGElement).dataset.part ?? ""] = Number(rect?.getAttribute("y"));
    }
    return found;
  });
}

/** The player on the map, once the look has replaced the plain marker. */
export async function playerOnTheMap(page: Page): Promise<Locator> {
  const player = page.getByRole("region", { name: "マップ" }).locator("[data-player]");
  await expect(player.locator("svg rect").first()).toBeAttached();
  return player;
}
