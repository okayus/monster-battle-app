/**
 * Drizzle schema. Only the tables the walking skeleton needs are defined here;
 * the full data model (master data, saves, owned monsters, skins) is specified
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
