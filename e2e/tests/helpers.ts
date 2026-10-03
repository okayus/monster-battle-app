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
