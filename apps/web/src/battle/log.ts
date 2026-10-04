/**
 * Turns what happened in a turn into text.
 *
 * The API reports events as data — who attacked, with what, for how much, and
 * what a win was worth — and says nothing about how to phrase them
 * (docs/04-api-design.md §エラーの返し方 makes the same choice for errors).
 * The wording lives here, on the side that shows it.
 */

import type { BattleEvent, Side } from "@mba/core";

export function describeEvent(event: BattleEvent, names: Record<Side, string>): string {
  // A switch with no default: a kind of event added to `@mba/core` and not
  // given words here is a type error, not a blank line in the log.
  switch (event.kind) {
    case "attack": {
      const target = event.by === "player" ? names.enemy : names.player;
      return `${names[event.by]} の ${event.move}！ ${target} に ${event.damage} のダメージ`;
    }
    case "fainted":
      return `${names[event.who]} は たおれた`;
    case "exp_gained":
      return `${names.player} は 経験値を ${event.amount} 手に入れた`;
    case "level_up":
      return `${names.player} は レベル ${event.level} に上がった！`;
  }
}
