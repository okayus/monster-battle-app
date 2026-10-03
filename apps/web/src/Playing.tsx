/**
 * A skin or a look, moving if it has more than one frame anywhere.
 *
 * The clock lives in here, so that whatever is around the sprite does not
 * re-render every time a frame goes by.
 */

import type { PaletteEntry, RenderableSkin } from "@mba/sprite";
import { Sprite, useElapsedMs } from "@mba/sprite-react";

export function Playing({
  skin,
  colours,
}: {
  skin: RenderableSkin;
  /** Colours worn in place of the drawn ones (see `<Sprite colours>`). */
  colours?: readonly PaletteEntry[];
}) {
  const animated = skin.parts.some((part) => part.frames.length > 1);
  // A still image has no use for a clock, so it is not given one.
  const elapsedMs = useElapsedMs(animated);
  return <Sprite skin={skin} colours={colours} elapsedMs={animated ? elapsedMs : undefined} />;
}
