/**
 * Turns what happened in a turn into text.
 *
 * The API reports events as data — who attacked, with what, for how much — and
 * says nothing about how to phrase them (docs/04-api-design.md §エラーの返し方
 * makes the same choice for errors). The wording lives here, on the side that
 * shows it.
 */

import type { BattleEvent, Side } from "@mba/core";

export function describeEvent(event: BattleEvent, names: Record<Side, string>): string {
  if (event.kind === "attack") {
    const target = event.by === "player" ? names.enemy : names.player;
    return `${names[event.by]} の ${event.move}！ ${target} に ${event.damage} のダメージ`;
  }
  return `${names[event.who]} は たおれた`;
}
