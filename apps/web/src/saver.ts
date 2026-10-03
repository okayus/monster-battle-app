/**
 * Sends the latest value to the server, one request at a time.
 *
 * Walking produces a save per step, faster than requests complete. Fired
 * independently, those requests can arrive out of order, and the position that
 * ends up stored is whichever one happened to land last — not where the player
 * actually is.
 *
 * So there is never more than one request in flight, and only the newest value
 * that has not been sent yet is remembered. When the request returns, that
 * value goes next. Everything in between is skipped, which is fine: of all the
 * places the player walked through, only the last one matters.
 */

import type { Result } from "@mba/core";

export type SaveStatus<E> = { kind: "saving" } | { kind: "saved" } | { kind: "failed"; error: E };

export function createSaver<T, E>(
  /** Must not reject: a failed request is an `err`, like everything in api.ts. */
  send: (value: T) => Promise<Result<unknown, E>>,
  onStatus: (status: SaveStatus<E>) => void,
): (value: T) => void {
  /** The newest value not sent yet, or undefined when there is nothing waiting. */
  let waiting: { value: T } | undefined;
  let busy = false;

  const drain = async () => {
    busy = true;
    while (waiting !== undefined) {
      const { value } = waiting;
      waiting = undefined;
      onStatus({ kind: "saving" });
      const result = await send(value);
      // Report an outcome only when it is the last word. If something newer
      // arrived meanwhile, the honest status is still "saving".
      if (waiting === undefined) {
        onStatus(result.ok ? { kind: "saved" } : { kind: "failed", error: result.error });
      }
    }
    busy = false;
  };

  return (value) => {
    waiting = { value };
    if (!busy) void drain();
  };
}
