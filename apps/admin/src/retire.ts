/**
 * Retiring, as the admin screens see it: what a form may still offer, and what
 * to say when the server refuses.
 *
 * Pure, like `forms.ts`, and for the same reason. None of it decides anything:
 * whether something may be retired is the server's call (`retirement.ts` in
 * the API), and what a form leaves out here the server would refuse anyway.
 */

import { describeError } from "./api.js";
import type { ApiError } from "./api.js";

/**
 * What a form offers to choose from: everything that is in use — and whatever
 * is chosen already, even if it has been retired since.
 *
 * The second half matters for a retired species or map that is being edited.
 * Leaving its retired move out of the form would not make the move go away; it
 * would only hide why saving is refused. Shown and ticked, it can be unticked.
 */
export function offered<T extends { id: string; retired: boolean }>(
  items: readonly T[],
  chosen: readonly string[],
): T[] {
  return items.filter((item) => !item.retired || chosen.includes(item.id));
}

/** The mark a retired item carries wherever its name is shown. */
export function withMark(name: string, retired: boolean): string {
  return retired ? `${name}（retire 済み）` : name;
}

const KIND_NAMES: Record<string, string> = {
  species: "種族",
  move: "技",
  map: "マップ",
  skin: "スキン",
};

/** "種族: モリダマ、イワダマ" — who is in the way, grouped by what they are. */
function namesIn(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const groups = new Map<string, string[]>();
  for (const entry of value as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { kind, name } = entry as { kind?: unknown; name?: unknown };
    if (typeof kind !== "string" || typeof name !== "string") continue;
    groups.set(kind, [...(groups.get(kind) ?? []), name]);
  }
  return [...groups]
    .map(([kind, names]) => `${KIND_NAMES[kind] ?? kind}: ${names.join("、")}`)
    .join(" / ");
}

/**
 * Why a retire or a restore was refused, in words an admin can act on. The
 * three refusals that are about retiring name what is in the way; anything
 * else is shown as the API said it.
 */
export function explainRetireError(error: ApiError): string {
  if (error.kind === "in_use") {
    return `使われているので retire できない（${namesIn(error.detail?.by)}）。先に、そちらが使うのをやめる。`;
  }
  if (error.kind === "depends_on_retired") {
    return `retire 済みのものを使っているので戻せない（${namesIn(error.detail?.on)}）。先に、そちらを戻すか、使うのをやめる。`;
  }
  if (error.kind === "protected") {
    return "これは retire できない。ほかのものが retire されたときの戻り先になっている。";
  }
  return `できなかった（${describeError(error)}）`;
}
