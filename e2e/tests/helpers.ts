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
 *
 * The start of the stroke is brought to the middle of the window first.
 * Scrolled only as far as needed it can end up on the window's bottom edge,
 * and then the rest of the stroke is below it: a real mouse cannot press what
 * is not on screen, and the stroke would quietly paint less than it was asked
 * to. Where the stroke ends is checked for the same reason.
 */
export async function stroke(page: Page, from: Locator, to: Locator): Promise<void> {
  await from.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center" }));
  const start = await centreOf(from);
  const end = await centreOf(to);
  const view = page.viewportSize();
  if (view !== null && (end.x < 0 || end.y < 0 || end.x >= view.width || end.y >= view.height)) {
    throw new Error(`the stroke would end outside the window, at (${end.x}, ${end.y})`);
  }
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

// ---------------------------------------------------------------------------
// Maps and the ways between them
// ---------------------------------------------------------------------------

export interface MapExit {
  at: Position;
  to: { mapId: string; position: Position };
}

interface AdminMap {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: string[];
  spawn: Position;
  encounters: { speciesId: string; weight: number }[];
  exits: MapExit[];
  retired: boolean;
}

/**
 * Makes a small map through the admin API and returns its id:
 *
 *     . g w      (0,0) path   (1,0) grass   (2,0) water
 *     @ . T      (0,1) spawn  (1,1) path    (2,1) tree
 */
export async function createPond(
  request: APIRequestContext,
  name: string,
  options: { speciesIds?: string[]; exits?: MapExit[] } = {},
): Promise<string> {
  const response = await request.post("/api/admin/maps", {
    data: {
      name,
      width: 3,
      height: 2,
      tiles: ["path", "grass", "water", "path", "path", "tree"],
      spawn: { x: 0, y: 1 },
      encounters: (options.speciesIds ?? []).map((speciesId) => ({ speciesId, weight: 1 })),
      exits: options.exits ?? [],
    },
  });
  expect(response.status(), `POST a map (${name})`).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

/** Replaces the starter map's exits, and leaves the rest of it as it is. */
export async function setStarterExits(request: APIRequestContext, exits: MapExit[]): Promise<void> {
  const all = (await (await request.get("/api/admin/maps")).json()) as AdminMap[];
  const start = all.find((map) => map.id === "start");
  if (start === undefined) throw new Error("there is no starter map");
  const { id: _id, retired: _retired, ...input } = start;
  const response = await request.put("/api/admin/maps/start", { data: { ...input, exits } });
  expect(response.ok(), "PUT the starter map's exits").toBe(true);
}

/** The exits the starter map has right now. */
export async function starterExits(request: APIRequestContext): Promise<MapExit[]> {
  const all = (await (await request.get("/api/admin/maps")).json()) as AdminMap[];
  return all.find((map) => map.id === "start")?.exits ?? [];
}

/** Retires something through the admin API, or brings it back. */
export async function setRetired(
  request: APIRequestContext,
  kind: "species" | "moves" | "maps" | "skins",
  id: string,
  retired: boolean,
): Promise<void> {
  const response = await request.put(`/api/admin/${kind}/${id}/retired`, { data: { retired } });
  expect(response.ok(), `${retired ? "retiring" : "restoring"} ${kind}/${id}`).toBe(true);
}

/**
 * Takes the player to a position on another map the only way there is: an
 * exit on the starter map that leads there, a save onto that exit, and a trip
 * through it. The exit is taken away again, so the starter map is left as it
 * was for the next test.
 */
export async function visit(
  request: APIRequestContext,
  mapId: string,
  position: Position,
): Promise<void> {
  const door = { x: 1, y: 1 };
  await setStarterExits(request, [{ at: door, to: { mapId, position } }]);
  await standAt(request, door.x, door.y);
  const travelled = await request.post("/api/travel");
  expect(travelled.ok(), "POST /api/travel").toBe(true);
  await setStarterExits(request, []);
}
