/**
 * The edge between HTTP and the rest of the API: turning a request body into a
 * value, and a bad body into a value as well.
 *
 * Handlers do not catch exceptions. The places where a library throws on bad
 * input are wrapped here, once, and come out as a `Result`.
 *
 * Reading a body is also the only thing a handler waits for. Everything after
 * it — reading the database, deciding, writing — is synchronous
 * (runtime.ts), so the `await` in front of `readBody` is the last one in any
 * route.
 */

import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";

import { err, ok } from "@mba/core";
import type { Result } from "@mba/core";

import { refuse } from "./refusals.js";

/** What can be wrong with a body before anyone has asked what it means. */
export type BodyError = { kind: "bad_json" } | { kind: "malformed"; at: string };

/** `c.req.json()` throws on a body that is not JSON. Here that becomes a value. */
export async function readJson(c: Context): Promise<Result<unknown, { kind: "bad_json" }>> {
  try {
    return ok(await c.req.json());
  } catch {
    return err({ kind: "bad_json" });
  }
}

/**
 * Refuses a body over `maxBytes` before any of it is parsed.
 *
 * This is what stops the server from buffering an arbitrarily large request.
 * A limit checked after parsing cannot do that job: by then the whole body is
 * already in memory.
 */
export function jsonBodyLimit(maxBytes: number) {
  return bodyLimit({
    maxSize: maxBytes,
    onError: (c) => refuse(c, { kind: "body_too_large", max: maxBytes }),
  });
}

/** `$.position.x`, `$.parts[2]` — the same path notation `parseSkin` reports. */
function pathOf(path: readonly PropertyKey[]): string {
  let at = "$";
  for (const key of path) at += typeof key === "number" ? `[${key}]` : `.${String(key)}`;
  return at;
}

/**
 * Checks the shape of a body against a zod schema: are the fields there, and
 * of the right type. Whether the values make sense in the game is not decided
 * here — that is `@mba/core`'s job (docs/04-api-design.md §層の分け方).
 *
 * The result is the schema's output, not the input: fields the schema does not
 * name are gone, so they cannot travel any further.
 */
export function parseShape<T>(
  schema: z.ZodType<T>,
  value: unknown,
): Result<T, { kind: "malformed"; at: string }> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  return err({ kind: "malformed", at: pathOf(parsed.error.issues[0]?.path ?? []) });
}

/**
 * A request body as a value of the schema's shape: `readJson`, then
 * `parseShape`. What most routes that take a body start with. (Skins and
 * looks do not: their shape is described by `@mba/sprite`, not by a schema.)
 */
export async function readBody<T>(c: Context, schema: z.ZodType<T>): Promise<Result<T, BodyError>> {
  const body = await readJson(c);
  if (!body.ok) return body;
  return parseShape(schema, body.value);
}
