import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { err, ok } from "@mba/core";
import type { Result } from "@mba/core";

import type { ApiError } from "./api.js";
import { Loaded, remember } from "./loaded.js";

/** What a screen would put on the page for a request, as markup. */
function shown(request: Promise<Result<string, ApiError>>): string {
  return renderToStaticMarkup(
    <Loaded
      from={request}
      waiting={<p>waiting</p>}
      failed={(error) => <p role="alert">failed: {error.kind}</p>}
    >
      {(value) => <p>here: {value}</p>}
    </Loaded>,
  );
}

/** A request that the test answers when it chooses to. */
function pending() {
  let answer = (_result: Result<string, ApiError>): void => {};
  const request = new Promise<Result<string, ApiError>>((resolve) => {
    answer = resolve;
  });
  return { request, answer };
}

describe("remember", () => {
  it("hands back the very promise it was given", () => {
    const request = Promise.resolve(ok("a"));
    expect(remember(request)).toBe(request);
  });
});

describe("Loaded", () => {
  it("shows what it was given to show while the request is on its way", () => {
    const { request } = pending();
    remember(request);
    expect(shown(request)).toBe("<p>waiting</p>");
  });

  it("shows the answer once it is in — on the first render, with no waiting in between", async () => {
    const { request, answer } = pending();
    remember(request);
    expect(shown(request)).toBe("<p>waiting</p>");

    answer(ok("the map"));
    await request;
    expect(shown(request)).toBe("<p>here: the map</p>");
  });

  it("shows a request that failed where the answer would have been: a failure is a value", async () => {
    const request = remember(Promise.resolve(err({ kind: "network" })));
    await request;
    expect(shown(request)).toBe('<p role="alert">failed: network</p>');
  });

  it("keeps each request's answer apart from every other's", async () => {
    const first = remember(Promise.resolve(ok("first")));
    const second = remember(Promise.resolve(ok("second")));
    const third = pending();
    remember(third.request);
    await Promise.all([first, second]);

    expect(shown(first)).toBe("<p>here: first</p>");
    expect(shown(second)).toBe("<p>here: second</p>");
    expect(shown(third.request)).toBe("<p>waiting</p>");
  });

  it("goes on showing the same answer however often it is asked", async () => {
    const request = remember(Promise.resolve(ok("once")));
    await request;
    remember(request);
    await request;
    expect(shown(request)).toBe("<p>here: once</p>");
    expect(shown(request)).toBe("<p>here: once</p>");
  });
});
