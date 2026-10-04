/**
 * Moves: the list, and the form that creates or replaces one.
 *
 * As on the other screens, nothing the form does is a defence. The limits on
 * the inputs spare the admin a 400; the server asks `checkMove` again, and
 * that answer is the one that counts.
 */

import { useState } from "react";
import type { CSSProperties } from "react";

import { MOVE_LIMITS } from "@mba/core";
import type { AdminMove } from "@mba/core";

import { createMove, describeError, fetchMoves, updateMove } from "./api.js";
import type { ApiError } from "./api.js";
import { blankMoveForm, moveFormOf, toMoveInput } from "./forms.js";
import type { MoveForm } from "./forms.js";
import { Loaded, couldNotLoad } from "./loaded.js";
import { withMark } from "./retire.js";
import { RetireControl } from "./RetireControl.js";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; error: ApiError };

export function MovesScreen() {
  const [loading] = useState(fetchMoves);

  return (
    <Loaded from={loading} waiting={<p>読み込み中…</p>} failed={couldNotLoad("技")}>
      {(moves) => <MoveEditor initial={moves} />}
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
const fields: CSSProperties = { display: "grid", gap: "0.75rem", justifyItems: "start" };

function item(retired: boolean): CSSProperties {
  return {
    width: "100%",
    textAlign: "left",
    font: "inherit",
    padding: "0.5rem",
    cursor: "pointer",
    opacity: retired ? 0.55 : 1,
  };
}

function MoveEditor({ initial }: { initial: AdminMove[] }) {
  const [moves, setMoves] = useState(initial);
  const first = moves[0];
  const [form, setForm] = useState<MoveForm>(() =>
    first === undefined ? blankMoveForm() : moveFormOf(first),
  );
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  /** The move in the form as the server last listed it, if it has been saved at all. */
  const current = moves.find((move) => move.id === form.id);

  const edit = (patch: Partial<MoveForm>) => {
    setForm((now) => ({ ...now, ...patch }));
    setSave({ kind: "idle" });
  };

  const choose = (next: MoveForm) => {
    setForm(next);
    setSave({ kind: "idle" });
  };

  const refresh = async () => {
    const fresh = await fetchMoves();
    if (fresh.ok) setMoves(fresh.value);
  };

  const submit = async () => {
    setSave({ kind: "saving" });
    const input = toMoveInput(form);
    const result = form.id === null ? await createMove(input) : await updateMove(form.id, input);
    if (!result.ok) {
      setSave({ kind: "failed", error: result.error });
      return;
    }
    // Show what the server stored, and ask for the list again: both are the
    // server's, in the server's order.
    setForm(moveFormOf(result.value));
    await refresh();
    setSave({ kind: "saved" });
  };

  return (
    <section aria-label="技">
      <h2>技</h2>
      <div style={columns}>
        <div>
          <ul style={list} aria-label="技の一覧">
            {moves.map((move) => (
              <li key={move.id}>
                <button
                  type="button"
                  style={item(move.retired)}
                  aria-pressed={form.id === move.id}
                  onClick={() => choose(moveFormOf(move))}
                >
                  <strong>{withMark(move.name, move.retired)}</strong>
                  <br />
                  威力 {move.power}
                </button>
              </li>
            ))}
          </ul>
          <p>
            <button type="button" onClick={() => choose(blankMoveForm())}>
              新しい技
            </button>
          </p>
        </div>

        <form
          style={fields}
          aria-label="技のフォーム"
          onSubmit={(event) => {
            event.preventDefault();
            if (save.kind !== "saving") void submit();
          }}
        >
          <h3>{form.id === null ? "新しい技" : "技を編集"}</h3>

          <label>
            名前{" "}
            <input
              value={form.name}
              maxLength={MOVE_LIMITS.maxNameLength}
              onChange={(event) => edit({ name: event.target.value })}
            />
          </label>

          <label>
            威力{" "}
            <input
              type="number"
              min={1}
              max={MOVE_LIMITS.maxPower}
              style={{ width: "5rem" }}
              value={Number.isNaN(form.power) ? "" : form.power}
              onChange={(event) => edit({ power: event.target.valueAsNumber })}
            />
          </label>

          <p>
            <button type="submit" disabled={save.kind === "saving"}>
              {save.kind === "saving" ? "保存中…" : "保存"}
            </button>{" "}
            {save.kind === "saved" && <span role="status">保存した</span>}
          </p>
          {save.kind === "failed" && (
            <p role="alert">保存できなかった（{describeError(save.error)}）</p>
          )}
          <p>変えた威力は、次に始まるバトルから効く。進行中のバトルは始まったときの値のまま。</p>

          {current !== undefined && (
            <RetireControl
              key={`${current.id}:${current.retired}`}
              kind="moves"
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
