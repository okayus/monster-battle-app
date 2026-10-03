import { describe, expect, it } from "vitest";

import { hrefs, parseRoute } from "./route.js";

describe("parseRoute", () => {
  it.each([
    ["no hash at all", ""],
    ["the root", "#/"],
    ["something it does not know", "#/nowhere"],
  ])("shows the map for %s", (_label, hash) => {
    expect(parseRoute(hash)).toEqual({ screen: "map" });
  });

  it("shows the editor", () => {
    expect(parseRoute("#/editor")).toEqual({ screen: "editor", skinId: null });
  });

  it("shows the editor with a saved skin", () => {
    const id = "170c2cb0-cf69-4cf2-ba79-38159de1ec3b";
    expect(parseRoute(`#/skins/${id}`)).toEqual({ screen: "editor", skinId: id });
  });

  it.each([
    ["a path that climbs out", "#/skins/../../admin"],
    ["an empty id", "#/skins/"],
    ["an id with a query", "#/skins/abc?x=1"],
    ["uppercase, which no id contains", "#/skins/ABC"],
    ["an id longer than any id", `#/skins/${"a".repeat(65)}`],
  ])("does not take %s for a skin id", (_label, hash) => {
    expect(parseRoute(hash)).toEqual({ screen: "map" });
  });

  it("round-trips every link the app can produce", () => {
    expect(parseRoute(hrefs.map)).toEqual({ screen: "map" });
    expect(parseRoute(hrefs.editor)).toEqual({ screen: "editor", skinId: null });
    expect(parseRoute(hrefs.skin("abc-123"))).toEqual({ screen: "editor", skinId: "abc-123" });
  });
});
