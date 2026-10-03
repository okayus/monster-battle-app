import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import type {
  BattleEvent,
  BattleView,
  MapInput,
  MonsterView,
  SaveData,
  TurnOutcome,
} from "@mba/core";
import { battles, ownedMonsters, saves, species } from "@mba/db";

import { LOCAL_USER_ID } from "./auth.js";
import { START_MAP_ID } from "./maps.js";
import { createMap, firstTile, rolls, setup, starter, visit } from "./testing.js";
import type { TestApp } from "./testing.js";

// ---------------------------------------------------------------------------
// What a battle leaves behind
//
// The numbers below are the seed's. The player's monster is a moss (24 health,
// attack 9, defense 9); "bite" has power 6.
//
// THE WIN. Rolls 0, 1, 0, 0 and then 0 for ever: a drop turns up (20 health,
// attack 10, defense 8, worth 9 experience). The moss bites for 6, then 5, 5
// and 5, which is four turns; the drop answers the first three with a bump
// for 4. The moss is left on 12 of 24.
//
// THE LOSS. Rolls 0.9, 0, 0.999, 1 and then 1 for ever: a rock turns up. The
// moss bumps it for 3 a turn, the rock bumps back for 4, and the moss faints
// on the sixth turn.
// ---------------------------------------------------------------------------

const WIN = [0, 1, 0, 0];
const LOSS = [0.9, 0, 0.999, 1];
const DROP_IS_WORTH = 9;
const LEFT_AFTER_THE_WIN = 12;

type Game = ReturnType<typeof setup>;

const GRASS: SaveData = { mapId: START_MAP_ID, position: firstTile("grass") };
const HOME: SaveData = { mapId: START_MAP_ID, position: starter().spawn };

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function standOnGrass(app: TestApp): Promise<void> {
  const res = await app.request("/api/save", json("PUT", GRASS));
  if (res.status !== 200) throw new Error(`could not stand on grass: ${res.status}`);
}

function search(app: TestApp) {
  return app.request("/api/battles", { method: "POST" });
}

/** A battle the player has just walked into. */
async function begin(app: TestApp): Promise<BattleView> {
  const res = await search(app);
  if (res.status !== 201) throw new Error(`expected a new battle, got ${res.status}`);
  return (await res.json()) as BattleView;
}

function turn(app: TestApp, battle: Pick<BattleView, "id" | "turn">, body: object = {}) {
  return app.request(
    `/api/battles/${battle.id}/turn`,
    json("POST", { moveId: "bite", turn: battle.turn, ...body }),
  );
}

async function play(app: TestApp, battle: BattleView, moveId = "bite"): Promise<TurnOutcome> {
  const res = await turn(app, battle, { moveId });
  if (res.status !== 200) throw new Error(`turn ${battle.turn} was refused: ${res.status}`);
  return (await res.json()) as TurnOutcome;
}

/** Plays the same move until the battle ends, and hands back the turn that ended it. */
async function playOut(app: TestApp, start: BattleView, moveId = "bite"): Promise<TurnOutcome> {
  let last = await play(app, start, moveId);
  // Every hit does at least 1, so this many turns outlasts any seeded monster.
  for (let n = 0; n < 100 && last.battle.status === "ongoing"; n++) {
    last = await play(app, last.battle, moveId);
  }
  return last;
}

/** Plays turns until the battle has been through this many. It must still be going. */
async function playUntilTurn(app: TestApp, start: BattleView, count: number): Promise<BattleView> {
  let battle = start;
  while (battle.turn < count) battle = (await play(app, battle)).battle;
  if (battle.status !== "ongoing")
    throw new Error("the battle ended sooner than this test assumes");
  return battle;
}

async function mine(app: TestApp): Promise<MonsterView> {
  const all = (await (await app.request("/api/monsters")).json()) as MonsterView[];
  const first = all[0];
  if (first === undefined) throw new Error("the player has no monster");
  return first;
}

async function saved(app: TestApp): Promise<SaveData> {
  return (await (await app.request("/api/save")).json()) as SaveData;
}

/** What is stored about the player's monster. */
function stored(db: Game["db"]) {
  const row = db.select().from(ownedMonsters).where(eq(ownedMonsters.userId, LOCAL_USER_ID)).get();
  if (row === undefined) throw new Error("the player has no monster");
  return { exp: row.exp, damage: row.damage };
}

function setStored(db: Game["db"], values: { exp?: number; damage?: number }): void {
  db.update(ownedMonsters).set(values).where(eq(ownedMonsters.userId, LOCAL_USER_ID)).run();
}

/** A game with the player on grass, and the rolls that decide what happens next. */
async function onGrass(...values: number[]): Promise<Game> {
  const game = setup({ random: rolls(...values) });
  await standOnGrass(game.app);
  return game;
}

/** The kinds of the events, in order: enough to say what a turn amounted to. */
function kinds(events: BattleEvent[]): string[] {
  return events.map((event) => event.kind);
}

// ---------------------------------------------------------------------------

describe("a battle that is won", () => {
  it("leaves the monster with what the enemy was worth, and with the damage it took", async () => {
    const { app, db } = await onGrass(...WIN);
    const end = await playOut(app, await begin(app));
    expect(end.battle.status).toBe("won");
    expect(end.battle.player.hp).toBe(LEFT_AFTER_THE_WIN);

    expect(stored(db)).toEqual({ exp: DROP_IS_WORTH, damage: 24 - LEFT_AFTER_THE_WIN });
    expect(await mine(app)).toMatchObject({
      level: 1,
      exp: DROP_IS_WORTH,
      hp: LEFT_AFTER_THE_WIN,
      maxHp: 24,
    });
  });

  it("says what was earned in the answer to the turn that ended it, after what the turn did", async () => {
    const { app } = await onGrass(...WIN);
    const end = await playOut(app, await begin(app));
    expect(end.events.slice(-2)).toEqual([
      { kind: "fainted", who: "enemy" },
      { kind: "exp_gained", amount: DROP_IS_WORTH },
    ]);
  });

  it("says nothing about experience on the turns before that", async () => {
    const { app } = await onGrass(...WIN);
    const first = await play(app, await begin(app));
    expect(first.battle.status).toBe("ongoing");
    expect(kinds(first.events)).toEqual(["attack", "attack"]);
  });

  it("takes the monster up a level when the experience gets there, and says so", async () => {
    const { app, db } = await onGrass(...WIN);
    setStored(db, { exp: 5 });
    const end = await playOut(app, await begin(app));

    expect(end.events.slice(-2)).toEqual([
      { kind: "exp_gained", amount: DROP_IS_WORTH },
      { kind: "level_up", level: 2 },
    ]);
    // Level 2 has 26 health at most. The 12 lost in the battle are still lost.
    expect(await mine(app)).toMatchObject({ level: 2, exp: 14, maxHp: 26, hp: 14 });
  });

  it("leaves the player where they were", async () => {
    const { app } = await onGrass(...WIN);
    await playOut(app, await begin(app));
    expect(await saved(app)).toEqual(GRASS);
  });

  it("pays once: the turn that ended it cannot be played again", async () => {
    const { app, db } = await onGrass(...WIN);
    const last = await playUntilTurn(app, await begin(app), 3);
    const end = await play(app, last);
    expect(end.battle.status).toBe("won");

    // The same request again, as a double click or a retry would send it.
    const again = await turn(app, last);
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: { kind: "stale_turn", turn: 4 } });
    // And one that has caught up with the turn count.
    const more = await turn(app, end.battle);
    expect(more.status).toBe(400);
    expect(await more.json()).toEqual({ error: { kind: "battle_over" } });

    expect(stored(db)).toEqual({ exp: DROP_IS_WORTH, damage: 24 - LEFT_AFTER_THE_WIN });
  });

  it("decides what was earned itself: nothing the request says about it is read", async () => {
    const { app, db } = await onGrass(...WIN);
    const last = await playUntilTurn(app, await begin(app), 3);
    const res = await turn(app, last, { exp: 9999, damage: 0, level: 50, amount: 9999 });
    expect(((await res.json()) as TurnOutcome).battle.status).toBe("won");
    expect(stored(db)).toEqual({ exp: DROP_IS_WORTH, damage: 24 - LEFT_AFTER_THE_WIN });
  });

  it("pays what the enemy was when the battle began, not what an edit has made of it since", async () => {
    const { app, db } = await onGrass(...WIN);
    const battle = await begin(app);
    db.update(species)
      .set({ maxHp: 999, attack: 999, defense: 999 })
      .where(eq(species.id, "drop"))
      .run();

    await playOut(app, battle);
    expect(stored(db).exp).toBe(DROP_IS_WORTH);
  });

  it("writes to the monster that went in, and to no other", async () => {
    const { app, db } = await onGrass(...WIN);
    db.insert(ownedMonsters)
      .values({
        id: "the-other-one",
        userId: LOCAL_USER_ID,
        speciesId: "rock",
        nickname: null,
        createdAt: new Date("2100-01-01"),
      })
      .run();

    await playOut(app, await begin(app));
    const other = db
      .select()
      .from(ownedMonsters)
      .where(eq(ownedMonsters.id, "the-other-one"))
      .get();
    expect(other).toMatchObject({ exp: 0, damage: 0 });
    expect(stored(db).exp).toBe(DROP_IS_WORTH);
  });
});

describe("the next battle", () => {
  it("starts with the health the last one left, not with full health", async () => {
    const { app } = await onGrass(...WIN);
    await playOut(app, await begin(app));

    const next = await begin(app);
    expect(next.player).toMatchObject({ level: 1, hp: LEFT_AFTER_THE_WIN, maxHp: 24 });
    // The wild one is a new monster, and unhurt.
    expect(next.enemy.hp).toBe(next.enemy.maxHp);
  });

  it("starts with the level the last one brought, and what that level adds", async () => {
    const { app, db } = await onGrass(...WIN);
    setStored(db, { exp: 5 });
    await playOut(app, await begin(app));

    expect((await begin(app)).player).toMatchObject({ level: 2, hp: 14, maxHp: 26 });
  });

  it("adds its damage to what was already lost", async () => {
    // The first battle is the win above. In the second one the moss bites for
    // 5 four times and takes 4 three times: 12 more, down to nothing left.
    const { app, db } = await onGrass(...WIN);
    await playOut(app, await begin(app));
    const second = await begin(app);
    const first = await play(app, second);
    expect(first.battle.player.hp).toBe(LEFT_AFTER_THE_WIN - 4);
    expect(stored(db).damage).toBe(24 - LEFT_AFTER_THE_WIN);
  });
});

describe("a battle that is lost", () => {
  it("earns nothing, restores the monster, and puts the player back where a new game starts", async () => {
    const { app, db } = await onGrass(...LOSS);
    setStored(db, { exp: 7 });
    const end = await playOut(app, await begin(app), "bump");
    expect(end.battle.status).toBe("lost");
    expect(end.battle.player.hp).toBe(0);

    expect(stored(db)).toEqual({ exp: 7, damage: 0 });
    expect(await mine(app)).toMatchObject({ exp: 7, hp: 24, maxHp: 24 });
    expect(await saved(app)).toEqual(HOME);
  });

  it("has nothing to add to the turn that ended it", async () => {
    const { app } = await onGrass(...LOSS);
    const end = await playOut(app, await begin(app), "bump");
    expect(end.events.at(-1)).toEqual({ kind: "fainted", who: "player" });
    expect(kinds(end.events)).not.toContain("exp_gained");
  });

  it("restores a monster that went in already hurt", async () => {
    const { app, db } = await onGrass(...LOSS);
    setStored(db, { damage: 15 });
    const battle = await begin(app);
    expect(battle.player.hp).toBe(9);

    expect((await playOut(app, battle, "bump")).battle.status).toBe("lost");
    expect(stored(db).damage).toBe(0);
  });

  it("puts the player back from another map as well", async () => {
    // A pond where only rocks live:  . g w     the grass is at (1,0)
    //                                @ . T
    const { app } = setup({ random: rolls(...LOSS) });
    const pond: MapInput = {
      name: "いわの池",
      width: 3,
      height: 2,
      tiles: ["path", "grass", "water", "path", "path", "tree"],
      spawn: { x: 0, y: 1 },
      encounters: [{ speciesId: "rock", weight: 1 }],
      exits: [],
    };
    const id = await createMap(app, pond);
    await visit(app, id, { x: 1, y: 0 });
    expect((await saved(app)).mapId).toBe(id);

    expect((await playOut(app, await begin(app), "bump")).battle.status).toBe("lost");
    expect(await saved(app)).toEqual(HOME);
  });

  it("leaves a player who is home with a save that takes them walking again", async () => {
    const { app } = await onGrass(...LOSS);
    await playOut(app, await begin(app), "bump");
    // The position is the server's, and an ordinary one: the next step is measured from it.
    expect((await app.request("/api/save", json("PUT", GRASS))).status).toBe(200);
  });
});

describe("one battle at a time", () => {
  it("gives back the battle that is not over, instead of starting another", async () => {
    let drawn = 0;
    const game = setup({
      random: () => {
        drawn++;
        return 0;
      },
    });
    await standOnGrass(game.app);

    const first = await search(game.app);
    expect(first.status).toBe(201);
    const battle = (await first.json()) as BattleView;
    expect(drawn).toBe(1);

    const again = await search(game.app);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(battle);
    expect(again.headers.get("Location")).toBe(`/api/battles/${battle.id}`);
    // Nothing was rolled and nothing was written: there is still the one battle.
    expect(drawn).toBe(1);
    expect(game.db.select().from(battles).all()).toHaveLength(1);
  });

  it("gives it back as it stands, with the turns already played", async () => {
    const { app } = await onGrass(...WIN);
    const after = (await play(app, await begin(app))).battle;
    expect(after.turn).toBe(1);

    const again = await search(app);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(after);
  });

  it("starts a new one once the last is over", async () => {
    const { app, db } = await onGrass(...WIN);
    const first = await begin(app);
    await playOut(app, first);

    const next = await search(app);
    expect(next.status).toBe(201);
    expect(((await next.json()) as BattleView).id).not.toBe(first.id);
    expect(db.select().from(battles).all()).toHaveLength(2);
  });

  it("still asks where the player is first: off the grass there is no battle to go back to", async () => {
    const { app } = await onGrass(...WIN);
    await begin(app);
    await app.request("/api/save", json("PUT", HOME));

    const res = await search(app);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { kind: "no_encounters_here" } });
  });

  it("is said by the table itself: a second battle for a monster in one cannot be written", async () => {
    const { app, db } = await onGrass(...WIN);
    await begin(app);
    const row = db.select().from(battles).get();
    if (row === undefined) throw new Error("no battle was stored");

    expect(() =>
      db
        .insert(battles)
        .values({ ...row, id: "a-second-one" })
        .run(),
    ).toThrow(/UNIQUE constraint failed: battles\.monster_id/);
    // Finished battles are not held to it: a monster has as many of those as it has fought.
    for (const [id, status] of [
      ["an-old-win", "won"],
      ["an-old-loss", "lost"],
    ] as const) {
      expect(() =>
        db
          .insert(battles)
          .values({ ...row, id, status })
          .run(),
      ).not.toThrow();
    }
    // And a finished one cannot be made to go on again beside the one that is.
    expect(() =>
      db.update(battles).set({ status: "ongoing" }).where(eq(battles.id, "an-old-win")).run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("says, in the list of monsters, which battle a monster is in, until it is over", async () => {
    const { app } = await onGrass(...WIN);
    expect((await mine(app)).battleId).toBeNull();

    const battle = await begin(app);
    const during = await mine(app);
    expect(during.battleId).toBe(battle.id);
    // What it has left is in the battle. Here it shows what it went in with.
    const afterOneTurn = (await play(app, battle)).battle;
    expect(afterOneTurn.player.hp).toBeLessThan(during.hp);
    expect((await mine(app)).hp).toBe(during.hp);

    await playOut(app, afterOneTurn);
    expect((await mine(app)).battleId).toBeNull();
  });
});

describe("the write at the end of a battle", () => {
  /** Makes every write to a table fail, the way a full disk or a bug would. */
  function breakWritesTo(db: Game["db"], table: "owned_monsters" | "saves"): void {
    for (const when of ["INSERT", "UPDATE"]) {
      db.run(
        sql.raw(
          `CREATE TRIGGER broken_${table}_${when} BEFORE ${when} ON ${table} BEGIN SELECT RAISE(ABORT, 'this table is broken'); END`,
        ),
      );
    }
  }

  function mend(db: Game["db"], table: "owned_monsters" | "saves"): void {
    for (const when of ["INSERT", "UPDATE"])
      db.run(sql.raw(`DROP TRIGGER broken_${table}_${when}`));
  }

  it("is all or nothing: if the monster cannot be written, the battle has not ended either", async () => {
    const { app, db } = await onGrass(...WIN);
    const last = await playUntilTurn(app, await begin(app), 3);
    const before = db.select().from(battles).get();

    breakWritesTo(db, "owned_monsters");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await turn(app, last);
    quiet.mockRestore();
    expect(failed.status).toBe(500);

    // The battle is exactly where it was: still going, on the same turn.
    expect(db.select().from(battles).get()).toEqual(before);
    expect(stored(db)).toEqual({ exp: 0, damage: 0 });

    // So the turn has not been played, and can be: it then pays, once.
    mend(db, "owned_monsters");
    const end = await play(app, last);
    expect(end.battle.status).toBe("won");
    expect(stored(db)).toEqual({ exp: DROP_IS_WORTH, damage: 24 - LEFT_AFTER_THE_WIN });
  });

  it("is all or nothing for a loss as well: if the player cannot be moved, nothing else is written", async () => {
    const { app, db } = await onGrass(...LOSS);
    setStored(db, { damage: 3 });
    // In on 21, and 4 lost each turn: on 1 after five turns. The sixth ends it.
    const last = await playUntilTurn(app, await begin(app), 5);
    expect(last.player.hp).toBe(1);
    const before = db.select().from(battles).get();

    breakWritesTo(db, "saves");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await turn(app, last, { moveId: "bump" });
    quiet.mockRestore();
    expect(failed.status).toBe(500);

    expect(db.select().from(battles).get()).toEqual(before);
    // Not restored, and not moved.
    expect(stored(db)).toEqual({ exp: 0, damage: 3 });
    expect(await saved(app)).toEqual(GRASS);

    mend(db, "saves");
    expect((await play(app, last, "bump")).battle.status).toBe("lost");
    expect(stored(db)).toEqual({ exp: 0, damage: 0 });
    expect(await saved(app)).toEqual(HOME);
  });
});

describe("a battle from before monsters kept anything", () => {
  /**
   * A row as the code before this step wrote it: no monster on it, and
   * combatants with no level in the stored state.
   */
  function insertOldBattle(db: Game["db"], enemyHp: number, playerHp = 24): string {
    const fighter = (name: string, hp: number) => ({
      name,
      skinId: "species-moss",
      maxHp: 24,
      hp,
      attack: 9,
      defense: 9,
      moves: [{ id: "bite", name: "かじる", power: 6 }],
    });
    const state = {
      turn: 0,
      status: "ongoing",
      player: fighter("モリダマ", playerHp),
      enemy: fighter("モリダマ", enemyHp),
    };
    const id = "from-before";
    db.insert(battles)
      .values({
        id,
        userId: LOCAL_USER_ID,
        status: "ongoing",
        state: JSON.stringify(state),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    return id;
  }

  it("is shown with both monsters at level 1, which is what they were", async () => {
    const { app, db } = setup();
    const id = insertOldBattle(db, 24);
    const view = (await (await app.request(`/api/battles/${id}`)).json()) as BattleView;
    expect(view.player.level).toBe(1);
    expect(view.enemy.level).toBe(1);
  });

  it("is not the battle a player is sent back to: it has no monster on it", async () => {
    const { app, db } = await onGrass(...WIN);
    const id = insertOldBattle(db, 24);
    const res = await search(app);
    expect(res.status).toBe(201);
    expect(((await res.json()) as BattleView).id).not.toBe(id);
  });

  it("can be played to a win, and leaves the monster as it was", async () => {
    const { app, db } = await onGrass(...WIN);
    setStored(db, { exp: 3, damage: 2 });
    const id = insertOldBattle(db, 1);

    const end = await play(app, { id, turn: 0 } as BattleView);
    expect(end.battle.status).toBe("won");
    expect(kinds(end.events)).toEqual(["attack", "fainted"]);
    expect(stored(db)).toEqual({ exp: 3, damage: 2 });
  });

  it("can be played to a loss, and leaves the player where they were", async () => {
    const { app, db } = await onGrass(...LOSS);
    setStored(db, { damage: 2 });
    const id = insertOldBattle(db, 24, 1);

    const end = await play(app, { id, turn: 0 } as BattleView);
    expect(end.battle.status).toBe("lost");
    expect(stored(db)).toEqual({ exp: 0, damage: 2 });
    expect(await saved(app)).toEqual(GRASS);
    expect(db.select().from(saves).all()).toHaveLength(1);
  });
});
