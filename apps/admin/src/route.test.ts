import { describe, expect, it } from "vitest";

import { hrefs, parseRoute } from "./route.js";

describe("parseRoute", () => {
  it.each(["", "#/", "#/species", "#/nowhere"])("shows species for %j", (hash) => {
    expect(parseRoute(hash)).toEqual({ screen: "species" });
  });

  it.each(["moves", "maps", "skins"] as const)("shows %s", (screen) => {
    expect(parseRoute(`#/${screen}`)).toEqual({ screen });
  });

  it("does not take a longer path that starts the same way for a screen", () => {
    expect(parseRoute("#/moves/bump")).toEqual({ screen: "species" });
  });

  it("round-trips every link the app can produce", () => {
    expect(parseRoute(hrefs.species)).toEqual({ screen: "species" });
    expect(parseRoute(hrefs.moves)).toEqual({ screen: "moves" });
    expect(parseRoute(hrefs.maps)).toEqual({ screen: "maps" });
    expect(parseRoute(hrefs.skins)).toEqual({ screen: "skins" });
  });
});
