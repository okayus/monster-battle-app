/**
 * Drizzle schema. Only the tables the slices built so far need are defined
 * here; the full data model (master data, saves, owned monsters) is specified
 * in docs/03-data-model.md and gets added as each slice is implemented.
 *
 * Rule of thumb encoded here: the database stores *identifiers and numbers*.
 * Artwork is never stored as a blob — a look is a recipe (which skin, which
 * variants, which colours), and that recipe is a handful of bytes.
 */

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
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
});

// Named *Row, not Skin: `Skin` is the validated shape in @mba/sprite, and a
// database row is a different thing (text columns, nullable owner).
export type SkinRow = typeof skins.$inferSelect;
export type NewSkinRow = typeof skins.$inferInsert;
