/**
 * What a request came back with, once it has.
 *
 * A screen does not keep "loading, failed, ready" in a state of its own, with
 * an effect to fill it in and a flag for the answer that arrives too late.
 * It starts a request, holds the promise, and hands it to `<Loaded>`: one
 * place that knows how to wait.
 *
 * A request that *failed* is not an exception — api.ts never rejects — so it
 * arrives here as an ordinary value and is rendered by `failed`, in the same
 * place the answer would have been.
 *
 * Requests are started by a screen that is already on the page (as its first
 * state: `useState(fetchSomething)`), or in an event handler, and handed down
 * as props. What a screen needs is then all asked for in one place, side by
 * side, and nothing further down has to know how to fetch.
 *
 * ---
 *
 * This is the shape of React's own `use()` and `<Suspense>`, and for a few
 * commits it *was* those. Two things were found by running it
 * (docs/05-roadmap.md, Step 13), and they are why this file reads a promise
 * itself instead:
 *
 * - Once a boundary has shown its fallback, React 19 will not show what
 *   replaces it until 300 ms have passed. Against an API that answers in a
 *   few milliseconds, every screen opened a third of a second later than it
 *   had before.
 * - A component rendered for the first time inside a boundary that is still
 *   waiting has no state until it is committed, and the render may be started
 *   over. A request begun there is begun again on each attempt.
 *
 * React's documentation says as much: reading data through Suspense without a
 * framework built for it is not supported yet. This app has no such framework
 * and is not adding one, so waiting stays an ordinary value here.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import type { Result } from "@mba/core";

import type { ApiError } from "./api.js";

/**
 * What each promise that has been waited for came to. Keyed by the promise
 * itself, and weakly: an entry goes when its promise does.
 *
 * Kept outside React because a promise cannot be asked what it holds — only
 * told to call back. Once a promise is in here, anything that reads it gets
 * its value at once, however many times it is read and by whomever.
 */
const SETTLED = new WeakMap<Promise<unknown>, unknown>();

/**
 * Takes note of what a promise comes to, and hands the same promise back.
 *
 * Whoever starts a request can call this on it. A reader that shows up after
 * the answer is in then has it on its first render, with no moment of
 * "waiting" in between — which is what lets one screen be swapped for the
 * next only once the next has what it needs.
 *
 * Must be given a promise that does not reject, like everything in api.ts.
 */
export function remember<T>(promise: Promise<T>): Promise<T> {
  void promise.then((value) => {
    if (!SETTLED.has(promise)) SETTLED.set(promise, value);
  });
  return promise;
}

/**
 * What a promise came to, or undefined while it is still on its way.
 *
 * (A promise of `undefined` could not be told from one that has not settled.
 * Nothing here makes one: every request resolves to a `Result` or a string.)
 */
export function useSettled<T>(promise: Promise<T>): T | undefined {
  const subscribe = useCallback(
    (onSettled: () => void) => {
      let listening = true;
      // After `remember`'s own callback, so the value is there to be read by
      // the time React is told to look.
      void remember(promise).then(() => {
        if (listening) onSettled();
      });
      return () => {
        listening = false;
      };
    },
    [promise],
  );
  const read = () => SETTLED.get(promise) as T | undefined;
  return useSyncExternalStore(subscribe, read, read);
}

export function Loaded<T>({
  from,
  waiting,
  failed,
  children,
}: {
  from: Promise<Result<T, ApiError>>;
  /** What to show until the answer is in. */
  waiting: ReactNode;
  failed: (error: ApiError) => ReactNode;
  children: (value: T) => ReactNode;
}) {
  const result = useSettled(from);
  if (result === undefined) return waiting;
  return result.ok ? children(result.value) : failed(result.error);
}
