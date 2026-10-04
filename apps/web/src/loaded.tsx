/**
 * What a request came back with, once it has.
 *
 * A screen does not keep "loading" in its state. It starts a request, holds
 * the promise, and hands it to this component inside a `<Suspense>`; the
 * boundary shows its fallback until the promise has a value, and then this
 * renders with it. There is no effect to clean up and no flag to check for a
 * request that outlived its component: a promise nobody is waiting for is
 * simply never read.
 *
 * Only waiting is handed to React. A request that *failed* is not an
 * exception — api.ts never rejects — so it arrives here as an ordinary value
 * and is rendered by `failed`, in the same place the answer would have been.
 *
 * The promise has to be the same one from render to render, so it is never
 * made by the component that reads it, and never by anything that is itself
 * still waiting to appear. It is made by a screen that is already on the page
 * (as its first state: `useState(fetchSomething)`), or in an event handler,
 * and passed down as a prop.
 *
 * That last part is not style. A component being rendered for the first time
 * inside a boundary that has not shown its content yet keeps no state until
 * React commits it — and React may start that render over before it does. A
 * request begun there is begun again on every attempt. (The map's marker did
 * exactly that for one commit of this file's history: about 120 requests for
 * the same picture in the first third of a second.)
 */

import { use } from "react";
import type { ReactNode } from "react";

import type { Result } from "@mba/core";

import type { ApiError } from "./api.js";

export function Loaded<T>({
  from,
  failed,
  children,
}: {
  from: Promise<Result<T, ApiError>>;
  failed: (error: ApiError) => ReactNode;
  children: (value: T) => ReactNode;
}) {
  // `use` is the one hook that keeps no slot of its own, which is why it may
  // sit above a branch like the one below — or inside one.
  const result = use(from);
  return result.ok ? children(result.value) : failed(result.error);
}
