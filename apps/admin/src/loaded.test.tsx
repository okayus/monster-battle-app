import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { err, ok } from "@mba/core";
import type { Result } from "@mba/core";

import type { ApiError } from "./api.js";
import { Loaded, couldNotLoad, remember } from "./loaded.js";

function shown(request: Promise<Result<string[], ApiError>>): string {
  return renderToStaticMarkup(
    <Loaded from={request} waiting={<p>waiting</p>} failed={couldNotLoad("技")}>
      {(moves) => <p>{moves.join("・")}</p>}
    </Loaded>,
  );
}

describe("Loaded", () => {
  it("shows what it was given to show while the request is on its way", () => {
    const never = new Promise<Result<string[], ApiError>>(() => {});
    expect(shown(remember(never))).toBe("<p>waiting</p>");
  });

  it("shows the answer once it is in, on the first render", async () => {
    const request = remember(Promise.resolve(ok(["ぶつかる", "かじる"])));
    await request;
    expect(shown(request)).toBe("<p>ぶつかる・かじる</p>");
  });
});

describe("what a screen says when its lists cannot be read", () => {
  async function refused(error: ApiError): Promise<string> {
    const request = remember(Promise.resolve(err(error)));
    await request;
    return shown(request);
  }

  it("says so to someone who is not an admin, without the server's word for it", async () => {
    expect(await refused({ kind: "forbidden", status: 403 })).toBe(
      '<p role="alert">管理者ではないので、この画面は使えない。</p>',
    );
  });

  it("says what could not be read, and why, for anything else", async () => {
    expect(await refused({ kind: "network" })).toBe(
      '<p role="alert">技を読み込めなかった（network）</p>',
    );
    expect(await refused({ kind: "bad_name", status: 400, detail: { max: 32 } })).toBe(
      '<p role="alert">技を読み込めなかった（bad_name {&quot;max&quot;:32}）</p>',
    );
  });
});
