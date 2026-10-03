/**
 * What the tests share.
 *
 * Preconditions are set through the API, not by clicking. A test about battles
 * should not fail because walking is broken; walking has tests of its own.
 */

import { expect } from "@playwright/test";
import type { APIRequestContext, APIResponse, Locator, Page } from "@playwright/test";

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

// ---------------------------------------------------------------------------
// Monsters, and battles a test can count on the outcome of
// ---------------------------------------------------------------------------

export interface MonsterView {
  id: string;
  name: string;
  level: number;
  exp: number;
  nextLevelAt: number | null;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  battleId: string | null;
}

/** The monster the player fights with, as the server has it. */
export async function leadMonster(request: APIRequestContext): Promise<MonsterView> {
  const response = await request.get("/api/monsters");
  expect(response.ok(), "GET /api/monsters").toBe(true);
  const [first] = (await response.json()) as MonsterView[];
  if (first === undefined) throw new Error("the player has no monster");
  return first;
}

interface Battle {
  id: string;
  turn: number;
  status: "ongoing" | "won" | "lost";
  player: { moves: { id: string }[] };
}

/**
 * Plays the battle the player's monster is in to its end, through the API.
 * Does nothing if it is in none.
 *
 * A monster is in one battle at a time, and the server keeps a battle that was
 * left halfway. A test that wants a battle of its own therefore has to see
 * off whatever an earlier test left behind.
 */
export async function finishBattle(request: APIRequestContext): Promise<void> {
  const { battleId } = await leadMonster(request);
  if (battleId === null) return;

  let battle = (await (await request.get(`/api/battles/${battleId}`)).json()) as Battle;
  // Every hit does at least 1, so this is more turns than a battle can take.
  for (let turn = 0; turn < 2000 && battle.status === "ongoing"; turn++) {
    const response = await request.post(`/api/battles/${battle.id}/turn`, {
      data: { moveId: battle.player.moves[0]?.id, turn: battle.turn },
    });
    expect(response.ok(), `POST turn ${battle.turn}`).toBe(true);
    battle = ((await response.json()) as { battle: Battle }).battle;
  }
  expect(battle.status, "the battle was played to its end").not.toBe("ongoing");
}

/**
 * Wild monsters whose battles go one way. The server rolls real dice, so a
 * test cannot arrange a win by choosing the rolls; it arranges one by choosing
 * who is fought. Each of these comes out the same whatever is rolled, and
 * whatever level the player's monster has reached by the time the test runs.
 */
const OPPONENTS = {
  /** Faints at the first hit, before it can answer. A win, with nothing lost. */
  pushover: { name: "よわダマ", maxHp: 1, attack: 1, defense: 1, power: 1 },
  /**
   * Too hard to hurt for more than 1 a hit, with 2 health: it takes one hit,
   * answers it for exactly 1, and faints at the second. A win, 1 health down.
   */
  scratcher: { name: "かたダマ", maxHp: 2, attack: 1, defense: 999, power: 1 },
  /** Cannot be brought down in time, and hits for thousands. A loss on the first turn. */
  crusher: { name: "つよダマ", maxHp: 999, attack: 999, defense: 999, power: 999 },
} as const;

export type Opponent = keyof typeof OPPONENTS;

/** Where the grass is on a pond made by `createPond`. */
export const POND_GRASS: Position = { x: 1, y: 0 };
/** Where a pond made by `arena` has its way back to the starter map. */
const POND_WAY_HOME: Position = { x: 0, y: 1 };

interface Arena {
  mapId: string;
  mapName: string;
  speciesId: string;
  speciesName: string;
  moveId: string;
}

const RUN = Date.now().toString(36);
const arenas = new Map<Opponent, Arena>();
/** How many arenas this run has made. Part of each name, so that one made again is not a namesake. */
let arenasMade = 0;

async function idOf(response: APIResponse, what: string): Promise<string> {
  expect(response.status(), what).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

/**
 * A pond where only one kind of monster lives. Made the first time it is
 * asked for, and kept until `closeArenas`. Its spawn tile is a way back to the
 * starter map, so a test that leaves the player here can be followed by one
 * that starts at home.
 */
export async function arena(request: APIRequestContext, opponent: Opponent): Promise<Arena> {
  const known = arenas.get(opponent);
  if (known !== undefined) return known;

  const { name, power, ...stats } = OPPONENTS[opponent];
  arenasMade += 1;
  const tag = `${RUN}-${arenasMade}`;
  const speciesName = `${name}-${tag}`;
  const mapName = `${name}の池-${tag}`;
  const moveId = await idOf(
    await request.post("/api/admin/moves", { data: { name: `${name}の技-${tag}`, power } }),
    `POST a move for ${opponent}`,
  );
  const speciesId = await idOf(
    await request.post("/api/admin/species", {
      data: { name: speciesName, ...stats, skinId: "species-moss", moveIds: [moveId] },
    }),
    `POST the species ${opponent}`,
  );
  const mapId = await createPond(request, mapName, {
    speciesIds: [speciesId],
    exits: [{ at: POND_WAY_HOME, to: { mapId: "start", position: { x: 1, y: 1 } } }],
  });

  const made = { mapId, mapName, speciesId, speciesName, moveId };
  arenas.set(opponent, made);
  return made;
}

/** Brings the player back to the starter map from an arena, through its way home. */
export async function goHome(request: APIRequestContext): Promise<void> {
  const save = (await (await request.get("/api/save")).json()) as { mapId: string };
  if (save.mapId === "start") return;

  const stood = await request.put("/api/save", {
    data: { mapId: save.mapId, position: POND_WAY_HOME },
  });
  expect(stood.ok(), "standing on the pond's way home").toBe(true);
  const travelled = await request.post("/api/travel");
  expect(travelled.ok(), "going home").toBe(true);
}

/**
 * Leaves the player at home, in no battle, with a monster at full health: how
 * a test finds things on an empty database.
 *
 * The game has one way to get a monster's health back, which is to lose a
 * battle. So that is what this does, when there is health to get back.
 */
export async function rest(request: APIRequestContext): Promise<void> {
  await finishBattle(request);
  await goHome(request);
  const before = await leadMonster(request);
  if (before.hp === before.maxHp) return;

  await visit(request, (await arena(request, "crusher")).mapId, POND_GRASS);
  const started = await request.post("/api/battles");
  expect(started.status(), "starting a battle to lose").toBe(201);
  await finishBattle(request);

  const after = await leadMonster(request);
  expect(after.hp, "the monster's health after losing").toBe(after.maxHp);
}

/**
 * Retires what `arena` made, in the order that is allowed: a map before the
 * species that lives on it, a species before the move it knows. Retiring the
 * map a player is standing on brings them home.
 */
export async function closeArenas(request: APIRequestContext): Promise<void> {
  await finishBattle(request);
  for (const made of arenas.values()) {
    await setRetired(request, "maps", made.mapId, true);
    await setRetired(request, "species", made.speciesId, true);
    await setRetired(request, "moves", made.moveId, true);
  }
  arenas.clear();
}
