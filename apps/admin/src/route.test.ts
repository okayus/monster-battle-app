import { describe, expect, it } from "vitest";

import { hrefs, parseRoute } from "./route.js";

describe("parseRoute", () => {
  it.each(["", "#/", "#/species", "#/nowhere"])("shows species for %j", (hash) => {
    expect(parseRoute(hash)).toEqual({ screen: "species" });
  });

  it("shows maps", () => {
    expect(parseRoute("#/maps")).toEqual({ screen: "maps" });
  });

  it("round-trips every link the app can produce", () => {
    expect(parseRoute(hrefs.species)).toEqual({ screen: "species" });
    expect(parseRoute(hrefs.maps)).toEqual({ screen: "maps" });
  });
});
