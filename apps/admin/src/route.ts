/**
 * Which screen the URL asks for. The same approach as the player SPA: the hash
 * is the only place the current screen is stored, and links are plain
 * `<a href>`.
 *
 *   #/species   the species list and form (and anything unrecognised)
 *   #/maps      the map list and editor
 */

export type Route = { screen: "species" } | { screen: "maps" };

export function parseRoute(hash: string): Route {
  return hash === "#/maps" ? { screen: "maps" } : { screen: "species" };
}

export const hrefs = { species: "#/species", maps: "#/maps" } as const;
