/**
 * Turns a monster's numbers into text.
 *
 * The API sends where the next level begins as a number, or null when there
 * is none, and says nothing about how to put that (the same split as
 * battle-log.ts). The wording lives here, on the side that shows it.
 */

import type { MonsterView } from "@mba/core";

/** How much experience a monster has, and how far it is from its next level. */
export function describeProgress(monster: Pick<MonsterView, "exp" | "nextLevelAt">): string {
  if (monster.nextLevelAt === null) return `経験値 ${monster.exp}（これ以上は上がらない）`;
  return `経験値 ${monster.exp}（つぎのレベルまで あと ${monster.nextLevelAt - monster.exp}）`;
}
