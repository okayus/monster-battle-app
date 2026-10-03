/**
 * The player SPA's calls to the API.
 *
 * Every function here returns a `Result` and never rejects. A failed request
 * is an ordinary outcome for a UI — offline, a validation error, a skin that
 * does not exist — so it is a value the caller has to handle, not an exception
 * it might forget to catch.
 *
 * Paths are relative (`/api/...`). The browser only ever talks to its own
 * origin: Vite proxies /api in development and Hono serves both in production,
 * so there is no base URL to configure and no CORS (docs/01-architecture.md).
 */

import { err, ok } from "@mba/core";
import type { GameMap, Result, SaveData } from "@mba/core";
import type { RenderableSkin, Skin } from "@mba/sprite";

/**
 * Why a call failed. `kind` is the API's own machine-readable `error.kind`
 * when the server answered with one (docs/04-api-design.md). Otherwise it is
 * one of two kinds that only exist on this side: `network` (no answer at all)
 * and `unexpected_response` (an answer that was not the API's JSON).
 */
export interface ApiError {
  kind: string;
  /** HTTP status, when there was a response. */
  status?: number;
}

/** Digs `error.kind` out of an error body, if the body has that shape. */
function kindOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("error" in body)) return undefined;
  const error = body.error;
  if (typeof error !== "object" || error === null || !("kind" in error)) return undefined;
  return typeof error.kind === "string" ? error.kind : undefined;
}

async function request<T>(path: string, init?: RequestInit): Promise<Result<T, ApiError>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return err({ kind: "network" });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return err({ kind: "unexpected_response", status: response.status });
  }

  if (!response.ok) {
    return err({ kind: kindOf(body) ?? "unexpected_response", status: response.status });
  }
  // A cast, not a check: this is the app's own server answering 2xx. Trust runs
  // one way across this boundary — the server validates what the browser sends,
  // and the browser believes what the server stored.
  return ok(body as T);
}

/** Saves a skin and returns the id the server gave it. */
export function createSkin(skin: Skin): Promise<Result<{ id: string }, ApiError>> {
  return request("/api/skins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(skin),
  });
}

/** Fetches the render-ready form of a saved skin. */
export function fetchSkin(id: string): Promise<Result<RenderableSkin, ApiError>> {
  // The id can come from the address bar, so it is escaped rather than assumed
  // to be a single path segment.
  return request(`/api/skins/${encodeURIComponent(id)}`);
}

/** Where the player is. The server answers with the starting point if nothing was ever saved. */
export function fetchSave(): Promise<Result<SaveData, ApiError>> {
  return request("/api/save");
}

/** Stores where the player is. The server refuses anywhere a player cannot stand. */
export function putSave(save: SaveData): Promise<Result<SaveData, ApiError>> {
  return request("/api/save", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(save),
    // Lets the request finish even if the page is closed right after the last step.
    keepalive: true,
  });
}

export function fetchMap(id: string): Promise<Result<GameMap, ApiError>> {
  return request(`/api/maps/${encodeURIComponent(id)}`);
}
