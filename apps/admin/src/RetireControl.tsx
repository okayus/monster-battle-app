/**
 * The one control every list uses to retire an item or bring it back.
 *
 * Pressing it asks the server, and shows what the server said. There is no
 * check on this side for "is this still used": the lists on screen could be
 * stale, and the server's answer names what is in the way better than a guess
 * from here would.
 */

import { useState } from "react";

import { setRetired } from "./api.js";
import type { ApiError, RetirableKind } from "./api.js";
import { explainRetireError } from "./retire.js";

type State = { kind: "idle" } | { kind: "working" } | { kind: "failed"; error: ApiError };

/**
 * The caller keys this by the item and its state (`${id}:${retired}`), so a
 * refusal shown for one item does not stay on screen under another.
 */
export function RetireControl({
  kind,
  id,
  retired,
  onChanged,
  quiet = false,
}: {
  kind: RetirableKind;
  id: string;
  retired: boolean;
  /** Called once the server has done it. The caller asks for its list again. */
  onChanged: () => void | Promise<void>;
  /** Leaves out the sentence about what retiring does, for a list that has one control per row. */
  quiet?: boolean;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const press = async () => {
    setState({ kind: "working" });
    const result = await setRetired(kind, id, !retired);
    if (!result.ok) {
      setState({ kind: "failed", error: result.error });
      return;
    }
    setState({ kind: "idle" });
    await onChanged();
  };

  return (
    <div role="group" aria-label="retire">
      <button type="button" disabled={state.kind === "working"} onClick={() => void press()}>
        {retired ? "戻す" : "retire する"}
      </button>{" "}
      {!quiet && (
        <span>
          {retired
            ? "retire 済み。一覧や選択肢には出ていない。"
            : "retire しても消えない。出なくなるだけで、あとで戻せる。"}
        </span>
      )}
      {state.kind === "failed" && <p role="alert">{explainRetireError(state.error)}</p>}
    </div>
  );
}
