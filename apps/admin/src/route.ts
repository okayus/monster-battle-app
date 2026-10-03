/**
 * Which screen the URL asks for. The same approach as the player SPA: the hash
 * is the only place the current screen is stored, and links are plain
 * `<a href>`.
 *
 *   #/species   the species list and form (and anything unrecognised)
 *   #/moves     the move list and form
 *   #/maps      the map list and editor
 *   #/skins     every skin, to retire one or bring it back
 */

export type Route =
  | { screen: "species" }
  | { screen: "moves" }
  | { screen: "maps" }
  | { screen: "skins" };

export function parseRoute(hash: string): Route {
  if (hash === "#/moves") return { screen: "moves" };
  if (hash === "#/maps") return { screen: "maps" };
  if (hash === "#/skins") return { screen: "skins" };
  return { screen: "species" };
}

export const hrefs = {
  species: "#/species",
  moves: "#/moves",
  maps: "#/maps",
  skins: "#/skins",
} as const;
