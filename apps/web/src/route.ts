/**
 * Which screen the URL asks for.
 *
 * The address bar is the only place the current screen is stored. There is no
 * router library and no "current screen" in React state: the hash is parsed
 * into a `Route` here, and `App` renders whatever that says. Links are plain
 * `<a href>`, so back, forward and reload work without any code.
 *
 *   #/              the map (and anything unrecognised)
 *   #/editor        the skin editor
 *   #/skins/<id>    the skin editor, showing a saved skin
 */

export type Route = { screen: "map" } | { screen: "editor"; skinId: string | null };

/**
 * Only admits the characters an id is made of, so whatever else someone types
 * into the address bar never reaches a request.
 */
const SKIN_HASH = /^#\/skins\/([0-9a-f-]{1,64})$/;

export function parseRoute(hash: string): Route {
  if (hash === "#/editor") return { screen: "editor", skinId: null };
  const skinId = SKIN_HASH.exec(hash)?.[1];
  if (skinId !== undefined) return { screen: "editor", skinId };
  return { screen: "map" };
}

/** The other direction: the hash for each place a link can go. */
export const hrefs = {
  map: "#/",
  editor: "#/editor",
  skin: (id: string) => `#/skins/${id}`,
} as const;
