import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { GROWTH, expToReach } from "@mba/core";
import type { MonsterView, Species } from "@mba/core";
import { ownedMonsters, species, users } from "@mba/db";

import { LOCAL_USER_ID } from "./auth.js";
import { findSpecies, leadMonsterOf } from "./monsters.js";
import { setup } from "./testing.js";
import type { TestApp } from "./testing.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof setup>["db"];

function kind(db: Db, id: string): Species {
  const found = findSpecies(db, id);
  if (found === undefined) throw new Error(`the seed has no species "${id}"`);
  return found;
}

async function list(app: TestApp): Promise<MonsterView[]> {
  const res = await app.request("/api/monsters");
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  return (await res.json()) as MonsterView[];
}

/** What the starter monster has earned and lost, written straight into its row. */
function setStarter(db: Db, values: { exp?: number; damage?: number }): void {
  db.update(ownedMonsters).set(values).where(eq(ownedMonsters.userId, LOCAL_USER_ID)).run();
}

// ---------------------------------------------------------------------------

describe("GET /api/monsters", () => {
  it("lists the monster a new player starts with: level 1, unhurt, as its species is", async () => {
    const { app, db } = setup();
    const moss = kind(db, "moss");
    const row = db.select().from(ownedMonsters).get();

    expect(await list(app)).toEqual([
      {
        id: row?.id,
        name: moss.name,
        skinId: moss.skinId,
        level: 1,
        exp: 0,
        nextLevelAt: 10,
        hp: moss.maxHp,
        maxHp: moss.maxHp,
        attack: moss.attack,
        defense: moss.defense,
        moves: moss.moves,
      },
    ]);
  });

  it("works the level and the health out of the two numbers that are stored", async () => {
    const { app, db } = setup();
    const moss = kind(db, "moss");
    setStarter(db, { exp: 45, damage: 6 });

    const [mine] = await list(app);
    // 45 is past where level 3 begins (40), and a tenth more per level is 24 + 4.
    expect(mine).toMatchObject({
      level: 3,
      exp: 45,
      nextLevelAt: 90,
      maxHp: moss.maxHp + 4,
      hp: moss.maxHp + 4 - 6,
      attack: moss.attack + 1,
      defense: moss.defense + 1,
    });
  });

  it("stores no level and no health: the row is the species, a name and two numbers", async () => {
    const { db } = setup();
    const row = db.select().from(ownedMonsters).get();
    expect(Object.keys(row ?? {}).sort()).toEqual(
      ["createdAt", "damage", "exp", "id", "nickname", "speciesId", "userId"].sort(),
    );
    // A monster from before these columns existed gets the same as a new one.
    expect(row).toMatchObject({ exp: 0, damage: 0 });
  });

  it("says there is no next level at the top", async () => {
    const { app, db } = setup();
    setStarter(db, { exp: expToReach(GROWTH.maxLevel) + 123 });

    const [mine] = await list(app);
    expect(mine?.level).toBe(GROWTH.maxLevel);
    expect(mine?.nextLevelAt).toBeNull();
  });

  it("follows the species: an edit to it shows on the monsters that already exist", async () => {
    const { app, db } = setup();
    setStarter(db, { damage: 6 });
    db.update(species).set({ maxHp: 40, attack: 20 }).where(eq(species.id, "moss")).run();

    expect((await list(app))[0]).toMatchObject({ maxHp: 40, hp: 34, attack: 20 });
  });

  it("leaves a monster standing when an edit takes its health below what it had lost", async () => {
    const { app, db } = setup();
    setStarter(db, { damage: 20 });
    db.update(species).set({ maxHp: 5 }).where(eq(species.id, "moss")).run();

    expect((await list(app))[0]).toMatchObject({ maxHp: 5, hp: 1 });
  });

  it("uses the nickname, when the monster has one", async () => {
    const { app, db } = setup();
    db.update(ownedMonsters).set({ nickname: "こけまる" }).run();
    expect((await list(app))[0]?.name).toBe("こけまる");
  });

  it("lists them in the order they were got, so the one that fights comes first", async () => {
    const { app, db } = setup();
    const first = db.select().from(ownedMonsters).get();
    if (first === undefined) throw new Error("the seed gave the player no monster");
    // Got a second later, and with an id that sorts before the first one's.
    db.insert(ownedMonsters)
      .values({
        id: "00000000-later",
        userId: LOCAL_USER_ID,
        speciesId: "rock",
        nickname: null,
        createdAt: new Date(first.createdAt.getTime() + 1000),
      })
      .run();

    expect((await list(app)).map((one) => one.id)).toEqual([first.id, "00000000-later"]);
    expect(leadMonsterOf(db, LOCAL_USER_ID)?.id).toBe(first.id);
  });

  it("breaks a tie on the time by the id, so the order is the same every time", async () => {
    const { app, db } = setup();
    const first = db.select().from(ownedMonsters).get();
    if (first === undefined) throw new Error("the seed gave the player no monster");
    for (const id of ["zz-same-moment", "00-same-moment"]) {
      db.insert(ownedMonsters)
        .values({
          id,
          userId: LOCAL_USER_ID,
          speciesId: "drop",
          nickname: null,
          createdAt: first.createdAt,
        })
        .run();
    }

    const expected = [first.id, "zz-same-moment", "00-same-moment"].sort();
    expect((await list(app)).map((one) => one.id)).toEqual(expected);
  });

  it("lists only the player's own", async () => {
    const { app, db } = setup();
    db.insert(users).values({ id: "other", displayName: "other", createdAt: new Date() }).run();
    db.insert(ownedMonsters)
      .values({
        id: "someone-elses",
        userId: "other",
        speciesId: "rock",
        nickname: null,
        createdAt: new Date(0),
      })
      .run();

    const mine = await list(app);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.name).toBe(kind(db, "moss").name);
  });

  it("answers with an empty list for a player who has none", async () => {
    const { app, db } = setup();
    db.delete(ownedMonsters).run();
    expect(await list(app)).toEqual([]);
  });

  it("still lists a monster whose species has been retired", async () => {
    const { app, db } = setup();
    db.update(species).set({ retiredAt: new Date() }).where(eq(species.id, "moss")).run();
    expect((await list(app))[0]?.name).toBe(kind(db, "moss").name);
  });

  it("sends what the screen shows, and not whose it is or what is stored", async () => {
    const { app } = setup();
    const sent = JSON.stringify(await list(app));
    expect(sent).not.toContain("userId");
    expect(sent).not.toContain(LOCAL_USER_ID);
    expect(sent).not.toContain("damage");
  });
});
