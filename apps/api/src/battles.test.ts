import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { calcDamage } from "@mba/core";
import type { BattleState, BattleView, Species, TurnOutcome } from "@mba/core";
import { battles, ownedMonsters, users } from "@mba/db";

import { LOCAL_USER_ID } from "./auth.js";
import { START_MAP_ID } from "./maps.js";
import { findSpecies } from "./monsters.js";
import { firstTile, rolls, setup } from "./testing.js";
import type { TestApp } from "./testing.js";

// ---------------------------------------------------------------------------
// Helpers
//
// The encounter roll, by the seeded weights (drop 3, moss 5, rock 2, in id
// order): below 0.3 is drop, below 0.8 is moss, the rest is rock.
// ---------------------------------------------------------------------------

const MEETS_DROP = 0;
const MEETS_MOSS = 0.5;
const MEETS_ROCK = 0.9;

type Setup = ReturnType<typeof setup>;

function kind(db: Setup["db"], id: string): Species {
  const found = findSpecies(db, id);
  if (found === undefined) throw new Error(`the seed has no species "${id}"`);
  return found;
}

/** Puts the player on grass, which is where battles can start. */
async function standOnGrass(app: TestApp): Promise<void> {
  const res = await app.request("/api/save", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapId: START_MAP_ID, position: firstTile("grass") }),
  });
  if (res.status !== 200) throw new Error(`could not stand on grass: ${res.status}`);
}

/** A game with the player on grass and a battle already started. */
async function inBattle(...values: number[]) {
  const game = setup({ random: rolls(...values) });
  await standOnGrass(game.app);
  const res = await game.app.request("/api/battles", { method: "POST" });
  if (res.status !== 201) throw new Error(`expected 201, got ${res.status}`);
  return { ...game, battle: (await res.json()) as BattleView };
}

function turn(app: TestApp, id: string, body: unknown) {
  return app.request(`/api/battles/${id}/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function view(app: TestApp, id: string): Promise<BattleView> {
  const res = await app.request(`/api/battles/${id}`);
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  return (await res.json()) as BattleView;
}

/** Plays the same move every turn until the battle ends. */
async function playOut(app: TestApp, start: BattleView, moveId: string): Promise<BattleView> {
  let battle = start;
  // Every hit does at least 1, so this many turns outlasts any seeded monster.
  for (let n = 0; n < 100 && battle.status === "ongoing"; n++) {
    const res = await turn(app, battle.id, { moveId, turn: battle.turn });
    if (res.status !== 200) throw new Error(`turn ${battle.turn} was refused: ${res.status}`);
    battle = ((await res.json()) as TurnOutcome).battle;
  }
  return battle;
}

// ---------------------------------------------------------------------------

describe("POST /api/battles", () => {
  it("does not start a battle where there are no wild monsters", async () => {
    // A new game starts on a path tile.
    const { app, db } = setup();
    const res = await app.request("/api/battles", { method: "POST" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { kind: "no_encounters_here" } });
    expect(db.select().from(battles).all()).toEqual([]);
  });

  it("starts one in the grass, with both sides at full health", async () => {
    const { db, battle } = await inBattle(MEETS_DROP);
    const mine = kind(db, "moss");
    const wild = kind(db, "drop");

    expect(battle).toEqual({
      id: battle.id,
      turn: 0,
      status: "ongoing",
      player: {
        name: mine.name,
        skinId: mine.skinId,
        level: 1,
        hp: mine.maxHp,
        maxHp: mine.maxHp,
        moves: mine.moves,
      },
      enemy: {
        name: wild.name,
        skinId: wild.skinId,
        level: 1,
        hp: wild.maxHp,
        maxHp: wild.maxHp,
      },
    });
  });

  it("says where the battle can be found", async () => {
    const game = setup();
    await standOnGrass(game.app);
    const res = await game.app.request("/api/battles", { method: "POST" });
    const battle = (await res.json()) as BattleView;
    expect(res.headers.get("Location")).toBe(`/api/battles/${battle.id}`);
  });

  it.each([
    ["a low roll", MEETS_DROP, "drop"],
    ["a middling roll", MEETS_MOSS, "moss"],
    ["a high roll", MEETS_ROCK, "rock"],
  ])("lets the server's roll decide who turns up: %s", async (_label, roll, speciesId) => {
    const { db, battle } = await inBattle(roll);
    expect(battle.enemy.name).toBe(kind(db, speciesId).name);
  });

  it("keeps the whole state on the server, and shows the browser only what it draws", async () => {
    const { db, battle } = await inBattle(MEETS_DROP);
    const row = db.select().from(battles).where(eq(battles.id, battle.id)).get();
    const state = JSON.parse(row?.state ?? "null") as BattleState;

    expect(row?.userId).toBe(LOCAL_USER_ID);
    expect(row?.status).toBe("ongoing");
    expect(state.enemy.attack).toBe(kind(db, "drop").attack);
    expect(state.enemy.moves.length).toBeGreaterThan(0);

    const sent = JSON.stringify(battle);
    expect(sent).not.toContain("attack");
    expect(sent).not.toContain("defense");
    expect(Object.keys(battle.enemy)).not.toContain("moves");
  });

  it("uses the position the server has, not one the request claims", async () => {
    // Still on the starting path tile; the body says otherwise.
    const { app } = setup();
    const res = await app.request("/api/battles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapId: START_MAP_ID, position: firstTile("grass") }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { kind: "no_encounters_here" } });
  });

  it("refuses a player who has no monster to send out", async () => {
    const { app, db } = setup();
    await standOnGrass(app);
    db.delete(ownedMonsters).run();

    const res = await app.request("/api/battles", { method: "POST" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { kind: "no_monster" } });
  });
});

describe("GET /api/battles/:id", () => {
  it("returns the battle as it stands", async () => {
    const { app, battle } = await inBattle(MEETS_DROP);
    expect(await view(app, battle.id)).toEqual(battle);
  });

  it("answers 404 for a battle that does not exist", async () => {
    const { app } = setup();
    const res = await app.request("/api/battles/no-such-battle");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { kind: "not_found" } });
  });

  it("answers 404 for someone else's battle, exactly as if it did not exist", async () => {
    const { app, db, battle } = await inBattle(MEETS_DROP);
    db.insert(users).values({ id: "other", displayName: "other", createdAt: new Date() }).run();
    db.update(battles).set({ userId: "other" }).where(eq(battles.id, battle.id)).run();

    const res = await app.request(`/api/battles/${battle.id}`);
    expect(res.status).toBe(404);
    const played = await turn(app, battle.id, { moveId: "bump", turn: 0 });
    expect(played.status).toBe(404);
  });
});

describe("POST /api/battles/:id/turn", () => {
  it("plays a turn with the server's rolls, and reports what happened", async () => {
    // Rolls, in the order they are drawn: who turns up, then for the turn —
    // how hard the player hits, which move the enemy uses, how hard it hits.
    const { app, db, battle } = await inBattle(MEETS_DROP, 1, 0, 0);
    const mine = kind(db, "moss");
    const wild = kind(db, "drop");
    const bite = mine.moves.find((move) => move.id === "bite");
    const reply = wild.moves[0];
    if (bite === undefined || reply === undefined) throw new Error("the seed changed its moves");

    const res = await turn(app, battle.id, { moveId: "bite", turn: 0 });
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as TurnOutcome;

    const dealt = calcDamage(mine, wild, bite, 1);
    const taken = calcDamage(wild, mine, reply, 0);
    expect(outcome.events).toEqual([
      { kind: "attack", by: "player", move: bite.name, damage: dealt },
      { kind: "attack", by: "enemy", move: reply.name, damage: taken },
    ]);
    expect(outcome.battle.turn).toBe(1);
    expect(outcome.battle.enemy.hp).toBe(wild.maxHp - dealt);
    expect(outcome.battle.player.hp).toBe(mine.maxHp - taken);

    // What was answered is what was stored.
    expect(await view(app, battle.id)).toEqual(outcome.battle);
  });

  it("gives a different result for the same request when the server rolls differently", async () => {
    const weak = await inBattle(MEETS_DROP, 0, 0, 0);
    const strong = await inBattle(MEETS_DROP, 1, 0, 0);
    const body = { moveId: "bite", turn: 0 };

    const low = (await (await turn(weak.app, weak.battle.id, body)).json()) as TurnOutcome;
    const high = (await (await turn(strong.app, strong.battle.id, body)).json()) as TurnOutcome;
    expect(high.battle.enemy.hp).toBeLessThan(low.battle.enemy.hp);
  });

  it("refuses the same turn twice, and plays it only once", async () => {
    const { app, battle } = await inBattle(MEETS_DROP);
    const body = { moveId: "bump", turn: 0 };

    const first = await turn(app, battle.id, body);
    expect(first.status).toBe(200);
    const after = ((await first.json()) as TurnOutcome).battle;

    const again = await turn(app, battle.id, body);
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: { kind: "stale_turn", turn: 1 } });
    expect(await view(app, battle.id)).toEqual(after);
  });

  it("refuses a move the player's monster does not know, and plays nothing", async () => {
    const { app, battle } = await inBattle(MEETS_DROP);
    // "fling" exists, but it is the wild monster's move, not the player's.
    const res = await turn(app, battle.id, { moveId: "fling", turn: 0 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { kind: "unknown_move", moveId: "fling" } });
    expect(await view(app, battle.id)).toEqual(battle);
  });

  it.each([
    ["no move", { turn: 0 }, "$.moveId"],
    ["no turn number", { moveId: "bump" }, "$.turn"],
    ["a turn number that is a string", { moveId: "bump", turn: "0" }, "$.turn"],
    ["a body that is not an object", null, "$"],
  ])("answers 400 for %s", async (_label, body, at) => {
    const { app, battle } = await inBattle(MEETS_DROP);
    const res = await turn(app, battle.id, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { kind: "malformed", at } });
    expect(await view(app, battle.id)).toEqual(battle);
  });

  it("answers 400 for a body that is not JSON", async () => {
    const { app, battle } = await inBattle(MEETS_DROP);
    const res = await turn(app, battle.id, "{ not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { kind: "bad_json" } });
  });

  it("ignores health the request tries to set", async () => {
    const { app, battle } = await inBattle(MEETS_DROP, 1, 0, 0);
    const res = await turn(app, battle.id, {
      moveId: "bump",
      turn: 0,
      enemy: { hp: 0 },
      player: { hp: 9999 },
      status: "won",
    });
    const outcome = (await res.json()) as TurnOutcome;
    expect(outcome.battle.status).toBe("ongoing");
    expect(outcome.battle.enemy.hp).toBeGreaterThan(0);
    expect(outcome.battle.player.hp).toBeLessThanOrEqual(outcome.battle.player.maxHp);
  });

  it("is won on the server when the wild monster faints, and then takes no more turns", async () => {
    // The player always lands full hits; the wild monster always lands weak ones.
    const { app, db, battle } = await inBattle(MEETS_DROP, 1, 0, 0);
    const end = await playOut(app, battle, "bite");

    expect(end.status).toBe("won");
    expect(end.enemy.hp).toBe(0);
    expect(end.player.hp).toBeGreaterThan(0);
    expect(db.select().from(battles).where(eq(battles.id, battle.id)).get()?.status).toBe("won");

    const more = await turn(app, battle.id, { moveId: "bite", turn: end.turn });
    expect(more.status).toBe(400);
    expect(await more.json()).toEqual({ error: { kind: "battle_over" } });
  });

  it("is lost on the server when the player's monster faints", async () => {
    // The sturdy one turns up; the player lands weak hits and takes full ones.
    const { app, db, battle } = await inBattle(MEETS_ROCK, 0, 0.999, 1);
    const end = await playOut(app, battle, "bump");

    expect(end.status).toBe("lost");
    expect(end.player.hp).toBe(0);
    expect(end.enemy.hp).toBeGreaterThan(0);
    expect(db.select().from(battles).where(eq(battles.id, battle.id)).get()?.status).toBe("lost");
  });
});
