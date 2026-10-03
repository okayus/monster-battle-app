/**
 * The admin SPA's calls to the API.
 *
 * Same conventions as the player SPA's: every function returns a `Result` and
 * never rejects, and paths are relative because the browser only ever talks
 * to its own origin (docs/01-architecture.md). The difference is the prefix —
 * everything that writes goes to `/api/admin`, which is the part of the API
 * behind the admin check.
 */

import { err, ok } from "@mba/core";
import type {
  AdminMap,
  AdminMove,
  AdminSpecies,
  MapInput,
  MoveInput,
  Result,
  SkinSummary,
  SpeciesInput,
} from "@mba/core";
import type { RenderableSkin } from "@mba/sprite";

/**
 * Why a call failed. `kind` is the API's own machine-readable `error.kind`
 * when the server answered with one, otherwise `network` (no answer at all) or
 * `unexpected_response` (an answer that was not the API's JSON).
 *
 * `detail` is the rest of the API's error object. An admin is the one person
 * for whom "which field, what value" is worth showing as it is.
 */
export interface ApiError {
  kind: string;
  status?: number;
  detail?: Record<string, unknown>;
}

function errorOf(body: unknown): { kind: string; detail: Record<string, unknown> } | undefined {
  if (typeof body !== "object" || body === null || !("error" in body)) return undefined;
  const error = body.error;
  if (typeof error !== "object" || error === null || !("kind" in error)) return undefined;
  if (typeof error.kind !== "string") return undefined;
  const { kind, ...detail } = error as { kind: string } & Record<string, unknown>;
  return { kind, detail };
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
    const error = errorOf(body);
    if (error === undefined) return err({ kind: "unexpected_response", status: response.status });
    return err({ kind: error.kind, status: response.status, detail: error.detail });
  }
  // A cast, not a check: this is the app's own server answering 2xx.
  return ok(body as T);
}

function withJson(method: "POST" | "PUT", body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function fetchSpecies(): Promise<Result<AdminSpecies[], ApiError>> {
  return request("/api/admin/species");
}

export function createSpecies(input: SpeciesInput): Promise<Result<AdminSpecies, ApiError>> {
  return request("/api/admin/species", withJson("POST", input));
}

export function updateSpecies(
  id: string,
  input: SpeciesInput,
): Promise<Result<AdminSpecies, ApiError>> {
  return request(`/api/admin/species/${encodeURIComponent(id)}`, withJson("PUT", input));
}

export function fetchMaps(): Promise<Result<AdminMap[], ApiError>> {
  return request("/api/admin/maps");
}

export function createMap(input: MapInput): Promise<Result<AdminMap, ApiError>> {
  return request("/api/admin/maps", withJson("POST", input));
}

export function updateMap(id: string, input: MapInput): Promise<Result<AdminMap, ApiError>> {
  return request(`/api/admin/maps/${encodeURIComponent(id)}`, withJson("PUT", input));
}

export function fetchMoves(): Promise<Result<AdminMove[], ApiError>> {
  return request("/api/admin/moves");
}

export function createMove(input: MoveInput): Promise<Result<AdminMove, ApiError>> {
  return request("/api/admin/moves", withJson("POST", input));
}

export function updateMove(id: string, input: MoveInput): Promise<Result<AdminMove, ApiError>> {
  return request(`/api/admin/moves/${encodeURIComponent(id)}`, withJson("PUT", input));
}

/** What can be retired, by the name it has in the API's paths. */
export type RetirableKind = "species" | "moves" | "maps" | "skins";

/**
 * Retires something, or brings it back. The same request either way: the body
 * says what should be true. Nothing is deleted by this (docs/03-data-model.md).
 */
export function setRetired(
  kind: RetirableKind,
  id: string,
  retired: boolean,
): Promise<Result<{ id: string; retired: boolean }, ApiError>> {
  return request(
    `/api/admin/${kind}/${encodeURIComponent(id)}/retired`,
    withJson("PUT", { retired }),
  );
}

export function fetchSkins(): Promise<Result<SkinSummary[], ApiError>> {
  return request("/api/admin/skins");
}

/**
 * A skin's drawing. This one is the game API, not the admin API: a preview
 * here is drawn from exactly what a player's screen would be given.
 */
export function fetchSkin(id: string): Promise<Result<RenderableSkin, ApiError>> {
  return request(`/api/skins/${encodeURIComponent(id)}`);
}

/** One line of text for an error: its kind, and the detail if there is any. */
export function describeError(error: ApiError): string {
  const detail = error.detail ?? {};
  return Object.keys(detail).length === 0 ? error.kind : `${error.kind} ${JSON.stringify(detail)}`;
}
