/**
 * Species: the list, and the form that creates or replaces one.
 *
 * Nothing the form does is a defence. The limits on the inputs spare the admin
 * a 400 they could have avoided; the server asks `checkSpecies` again, and
 * that answer is the one that counts.
 */

import { useState } from "react";
import type { CSSProperties } from "react";

import { SPECIES_LIMITS, err, ok } from "@mba/core";
import type { AdminMove, AdminSpecies, Result, SkinSummary } from "@mba/core";

import {
  createSpecies,
  describeError,
  fetchMoves,
  fetchSkins,
  fetchSpecies,
  updateSpecies,
} from "./api.js";
import type { ApiError } from "./api.js";
import { blankSpeciesForm, speciesFormOf, toSpeciesInput, toggleMove } from "./forms.js";
import type { SpeciesForm } from "./forms.js";
import { Loaded, couldNotLoad } from "./loaded.js";
import { offered, withMark } from "./retire.js";
import { RetireControl } from "./RetireControl.js";
import { SkinPreview } from "./SkinPreview.js";

/** The three lists the form is made of. */
interface Lists {
  species: AdminSpecies[];
  moves: AdminMove[];
  skins: SkinSummary[];
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; error: ApiError };

/** The form needs all three lists, so it waits for all three. */
async function load(): Promise<Result<Lists, ApiError>> {
  const [species, moves, skins] = await Promise.all([fetchSpecies(), fetchMoves(), fetchSkins()]);
  if (!species.ok) return err(species.error);
  if (!moves.ok) return err(moves.error);
  if (!skins.ok) return err(skins.error);
  return ok({ species: species.value, moves: moves.value, skins: skins.value });
}

export function SpeciesScreen() {
  const [loading] = useState(load);

  return (
    <Loaded from={loading} waiting={<p>読み込み中…</p>} failed={couldNotLoad("種族")}>
      {(lists) => <SpeciesEditor initial={lists} />}
    </Loaded>
  );
}

// ---------------------------------------------------------------------------

const columns: CSSProperties = { display: "flex", gap: "3rem", flexWrap: "wrap" };
const list: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "grid",
  gap: "0.5rem",
};
function item(retired: boolean): CSSProperties {
  return {
    display: "flex",
    gap: "0.75rem",
    alignItems: "center",
    width: "100%",
    textAlign: "left",
    font: "inherit",
    padding: "0.5rem",
    cursor: "pointer",
    opacity: retired ? 0.55 : 1,
  };
}
const fields: CSSProperties = { display: "grid", gap: "0.75rem", justifyItems: "start" };
const fieldRow: CSSProperties = { display: "flex", gap: "1rem", flexWrap: "wrap" };

function SpeciesEditor({ initial }: { initial: Lists }) {
  const [species, setSpecies] = useState(initial.species);
  const { moves, skins } = initial;

  // A new species starts with a skin that can actually be chosen.
  const firstSkin = skins.find((skin) => !skin.retired)?.id ?? "";
  const first = species[0];
  const [form, setForm] = useState<SpeciesForm>(() =>
    first === undefined ? blankSpeciesForm(firstSkin) : speciesFormOf(first),
  );
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  /** The species in the form as the server last listed it, if it has been saved at all. */
  const current = species.find((kind) => kind.id === form.id);

  const refresh = async () => {
    const fresh = await fetchSpecies();
    if (fresh.ok) setSpecies(fresh.value);
  };

  const edit = (patch: Partial<SpeciesForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setSave({ kind: "idle" });
  };

  const choose = (next: SpeciesForm) => {
    setForm(next);
    setSave({ kind: "idle" });
  };

  const submit = async () => {
    setSave({ kind: "saving" });
    const input = toSpeciesInput(form);
    const result =
      form.id === null ? await createSpecies(input) : await updateSpecies(form.id, input);
    if (!result.ok) {
      setSave({ kind: "failed", error: result.error });
      return;
    }
    // Show what the server stored, not what was typed. The list is asked for
    // again for the same reason: it is the server's, in the server's order.
    setForm(speciesFormOf(result.value));
    await refresh();
    setSave({ kind: "saved" });
  };

  const stat = (label: string, key: "maxHp" | "attack" | "defense") => (
    <label>
      {label}{" "}
      <input
        type="number"
        min={1}
        max={SPECIES_LIMITS.maxStat}
        style={{ width: "5rem" }}
        value={Number.isNaN(form[key]) ? "" : form[key]}
        onChange={(event) => edit({ [key]: event.target.valueAsNumber })}
      />
    </label>
  );

  return (
    <section aria-label="種族">
      <h2>種族</h2>
      <div style={columns}>
        <div>
          <ul style={list} aria-label="種族の一覧">
            {species.map((kind) => (
              <li key={kind.id}>
                <button
                  type="button"
                  style={item(kind.retired)}
                  aria-pressed={form.id === kind.id}
                  onClick={() => choose(speciesFormOf(kind))}
                >
                  <SkinPreview key={kind.skinId} skinId={kind.skinId} size="3rem" />
                  <span>
                    <strong>{withMark(kind.name, kind.retired)}</strong>
                    <br />
                    HP {kind.maxHp} / 攻 {kind.attack} / 防 {kind.defense}
                    <br />
                    {kind.moves.map((move) => move.name).join("・")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p>
            <button type="button" onClick={() => choose(blankSpeciesForm(firstSkin))}>
              新しい種族
            </button>
          </p>
        </div>

        <form
          style={fields}
          aria-label="種族のフォーム"
          onSubmit={(event) => {
            event.preventDefault();
            if (save.kind !== "saving") void submit();
          }}
        >
          <h3>{form.id === null ? "新しい種族" : "種族を編集"}</h3>

          <label>
            名前{" "}
            <input
              value={form.name}
              maxLength={SPECIES_LIMITS.maxNameLength}
              onChange={(event) => edit({ name: event.target.value })}
            />
          </label>

          <div style={fieldRow}>
            {stat("最大 HP", "maxHp")}
            {stat("攻撃", "attack")}
            {stat("防御", "defense")}
          </div>
          <small>
            レベル 1 のときの値。プレイヤーのモンスターは、レベルが 1 つ上がるごとに 1/10
            ずつ増える。
          </small>

          <label>
            見た目{" "}
            <select value={form.skinId} onChange={(event) => edit({ skinId: event.target.value })}>
              {/* What is in use — and the one chosen already, even if it has been retired. */}
              {offered(skins, [form.skinId]).map((skin) => (
                <option key={skin.id} value={skin.id}>
                  {withMark(skin.name, skin.retired)}（
                  {skin.ownerId === null ? "運営" : "プレイヤー作"}）
                </option>
              ))}
            </select>
          </label>
          <SkinPreview key={form.skinId} skinId={form.skinId} size="8rem" />

          <fieldset>
            <legend>技（1〜{SPECIES_LIMITS.maxMoves} 個）</legend>
            {offered(moves, form.moveIds).map((move) => (
              <label key={move.id} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={form.moveIds.includes(move.id)}
                  onChange={() => choose(toggleMove(form, move.id))}
                />{" "}
                {withMark(move.name, move.retired)}（威力 {move.power}）
              </label>
            ))}
          </fieldset>

          <p>
            <button type="submit" disabled={save.kind === "saving"}>
              {save.kind === "saving" ? "保存中…" : "保存"}
            </button>{" "}
            {save.kind === "saved" && <span role="status">保存した</span>}
          </p>
          {save.kind === "failed" && (
            <p role="alert">保存できなかった（{describeError(save.error)}）</p>
          )}

          {current !== undefined && (
            <RetireControl
              key={`${current.id}:${current.retired}`}
              kind="species"
              id={current.id}
              retired={current.retired}
              onChanged={refresh}
            />
          )}
        </form>
      </div>
    </section>
  );
}
