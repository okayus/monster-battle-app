/**
 * Drizzle schema. Only the tables the slices built so far need are defined
 * here; the full data model (master data, saves, owned monsters) is specified
 * in docs/03-data-model.md and gets added as each slice is implemented.
 *
 * Rule of thumb encoded here: the database stores *identifiers and numbers*.
 * Artwork is never stored as a blob — a look is a recipe (which skin, which
 * variants, which colours), and that recipe is a handful of bytes.
 */

import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * When a row was retired, or null while it is in use.
 *
 * Skins and master data are never deleted (docs/03-data-model.md §削除しない):
 * saves, looks and owned monsters refer to them, and a row that vanished would
 * leave those pointing at nothing. Retiring keeps the row and sets this. What
 * "retired" then means — left out of lists, fallen back from — is decided by
 * the code that reads, not here.
 */
const retiredAt = () => integer("retired_at", { mode: "timestamp" });

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  /**
   * Whether this user may use the admin API. Who the user *is* and what they
   * *may do* are separate questions: the first is answered per request (and
   * will change when real authentication arrives), the second is a fact about
   * the user, kept here.
   */
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/**
 * A skin, stored twice on purpose (docs/03-data-model.md):
 *
 *   source      the editable truth — run-length cells, what the editor reads back
 *   renderable  merged rectangles, derived from `source` once, at write time
 *
 * Both are JSON text, and this package deliberately does not know their shape.
 * The API turns untrusted input into a Skin (`parseSkin`) before it gets here
 * and serializes on the way in, so the database layer needs no dependency on
 * `@mba/sprite` — and has no way to hand out a skin that skipped validation.
 *
 * `ownerId` null means the skin ships with the game instead of belonging to a
 * player.
 */
export const skins = sqliteTable("skins", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").references(() => users.id),
  name: text("name").notNull(),
  formatVersion: integer("format_version").notNull(),
  source: text("source").notNull(),
  renderable: text("renderable").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  retiredAt: retiredAt(),
});

// Named *Row, not Skin: `Skin` is the validated shape in @mba/sprite, and a
// database row is a different thing (text columns, nullable owner).
export type SkinRow = typeof skins.$inferSelect;
export type NewSkinRow = typeof skins.$inferInsert;

/**
 * A map — master data, to be edited from the admin screen
 * (docs/03-data-model.md).
 *
 * `tiles` is a JSON array of tile kind names, row-major, `width * height` long.
 * Not an image: the same array answers "what is drawn here" and "can I walk
 * here", and later "can something attack me here".
 *
 * As with skins, this package stores the text without knowing its shape. The
 * tile kinds and the movement rules live in `@mba/core`.
 */
export const maps = sqliteTable("maps", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  tiles: text("tiles").notNull(),
  /** Where a player with no save starts. */
  spawnX: integer("spawn_x").notNull(),
  spawnY: integer("spawn_y").notNull(),
  retiredAt: retiredAt(),
});

export type MapRow = typeof maps.$inferSelect;
export type NewMapRow = typeof maps.$inferInsert;

/**
 * Where each player is. One row per user: the user is the primary key, so
 * saving again replaces the row instead of adding another.
 */
export const saves = sqliteTable("saves", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  mapId: text("map_id")
    .notNull()
    .references(() => maps.id),
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type SaveRow = typeof saves.$inferSelect;
export type NewSaveRow = typeof saves.$inferInsert;

/**
 * What each player looks like — as a recipe, never as a picture
 * (docs/03-data-model.md): which skin is worn, which slots are taken from
 * another skin, and which colours are worn in place of the drawn ones.
 *
 * One row per user, like `saves`. `skinId` is a real reference. The two
 * override columns are JSON text whose shape this package does not know, as
 * with skins: the API validates a recipe (`parseAppearance`), and checks that
 * what it names exists, before it gets here.
 */
export const appearances = sqliteTable("appearances", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  skinId: text("skin_id")
    .notNull()
    .references(() => skins.id),
  /** JSON object: slot → the id of the skin that slot is taken from. */
  partOverrides: text("part_overrides").notNull(),
  /** JSON array of `{ id, hex }`: the colours worn instead of the drawn ones. */
  colourOverrides: text("colour_overrides").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type AppearanceRow = typeof appearances.$inferSelect;

// ---------------------------------------------------------------------------
// Monsters — master data, to be edited from the admin screen
// ---------------------------------------------------------------------------

/** A move. What it does in a battle is decided by `@mba/core`, from `power`. */
export const moves = sqliteTable("moves", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  power: integer("power").notNull(),
  retiredAt: retiredAt(),
});

export type MoveRow = typeof moves.$inferSelect;

/**
 * A kind of monster. What it looks like is a reference to a skin, never the
 * art itself — the same skins players draw, with no owner.
 */
export const species = sqliteTable("species", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  maxHp: integer("max_hp").notNull(),
  attack: integer("attack").notNull(),
  defense: integer("defense").notNull(),
  skinId: text("skin_id")
    .notNull()
    .references(() => skins.id),
  retiredAt: retiredAt(),
});

export type SpeciesRow = typeof species.$inferSelect;

/** Which moves each species knows. The pair is the key, so a move is listed once. */
export const speciesMoves = sqliteTable(
  "species_moves",
  {
    speciesId: text("species_id")
      .notNull()
      .references(() => species.id),
    moveId: text("move_id")
      .notNull()
      .references(() => moves.id),
  },
  (table) => [primaryKey({ columns: [table.speciesId, table.moveId] })],
);

/**
 * Which species turn up on which map, and how often relative to each other.
 * A weight, not a percentage: adding a species to a map does not mean
 * re-balancing every other row so that they still add up to 100.
 */
export const mapEncounters = sqliteTable(
  "map_encounters",
  {
    mapId: text("map_id")
      .notNull()
      .references(() => maps.id),
    speciesId: text("species_id")
      .notNull()
      .references(() => species.id),
    weight: integer("weight").notNull(),
  },
  (table) => [primaryKey({ columns: [table.mapId, table.speciesId] })],
);

// ---------------------------------------------------------------------------
// Monsters — what belongs to a player
// ---------------------------------------------------------------------------

export const ownedMonsters = sqliteTable("owned_monsters", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  speciesId: text("species_id")
    .notNull()
    .references(() => species.id),
  nickname: text("nickname"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type OwnedMonsterRow = typeof ownedMonsters.$inferSelect;

/**
 * A battle in progress, or one that has ended.
 *
 * `state` is the whole battle as JSON (both sides' health, the turn count),
 * and it is the only copy: the browser is shown a view of it and sends back
 * nothing but the move it chose. `status` repeats one field of that state as a
 * column so that "the battles still going on" can be asked in SQL.
 */
export const battles = sqliteTable("battles", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  status: text("status").notNull(),
  state: text("state").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type BattleRow = typeof battles.$inferSelect;
