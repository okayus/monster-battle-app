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

  it("shows the dressing screen", () => {
    expect(parseRoute("#/look")).toEqual({ screen: "look" });
  });

  it("does not take a longer path that starts the same way for it", () => {
    expect(parseRoute("#/look/anything")).toEqual({ screen: "map" });
  });

  it("shows the player's monsters", () => {
    expect(parseRoute("#/monsters")).toEqual({ screen: "monsters" });
  });

  it.each([
    ["a longer path that starts the same way", "#/monsters/abc"],
    ["one monster's id, which has no screen of its own", "#/monsters/4da4a65e"],
    ["the singular", "#/monster"],
  ])("does not take %s for the monsters screen", (_label, hash) => {
    expect(parseRoute(hash)).toEqual({ screen: "map" });
  });

  it("shows a battle", () => {
    const id = "53ebc5e6-e3cb-48a9-9bc0-11a896fc57bc";
    expect(parseRoute(`#/battles/${id}`)).toEqual({ screen: "battle", battleId: id });
  });

  it.each([
    ["a path that climbs out", "#/battles/../../admin"],
    ["an empty id", "#/battles/"],
    ["something after the id", "#/battles/abc/turn"],
  ])("does not take %s for a battle id", (_label, hash) => {
    expect(parseRoute(hash)).toEqual({ screen: "map" });
  });

  it("round-trips every link the app can produce", () => {
    expect(parseRoute(hrefs.map)).toEqual({ screen: "map" });
    expect(parseRoute(hrefs.monsters)).toEqual({ screen: "monsters" });
    expect(parseRoute(hrefs.look)).toEqual({ screen: "look" });
    expect(parseRoute(hrefs.editor)).toEqual({ screen: "editor", skinId: null });
    expect(parseRoute(hrefs.skin("abc-123"))).toEqual({ screen: "editor", skinId: "abc-123" });
    expect(parseRoute(hrefs.battle("abc-123"))).toEqual({ screen: "battle", battleId: "abc-123" });
  });
});
