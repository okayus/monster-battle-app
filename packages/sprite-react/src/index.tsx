/**
 * React renderer for skins.
 *
 * Lives in its own package, separate from `@mba/sprite`, for one reason: the
 * API must validate skins without pulling React into its dependency graph.
 * `@mba/sprite` is pure and is imported by everything; this package is imported
 * only by the two browser apps.
 *
 * The renderer builds `<rect>` elements from numbers. It never parses or
 * injects markup, which is why user-authored skins are safe to display.
 */

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { frameAt } from "@mba/sprite";
import type { PaletteEntry, RenderableSkin } from "@mba/sprite";

function fillOf(palette: PaletteEntry[], index: number): string {
  const entry = palette[index - 1];
  if (!entry) return "magenta"; // out of range = corrupt data; make it obvious
  // Same shape the exporter emits: a CSS variable with the authored colour as
  // fallback, so a colour can be overridden from outside without touching data.
  return `var(--c-${entry.id}, ${entry.hex})`;
}

/**
 * The other half of `fillOf`: `--c-<id>: <hex>` for each colour to be worn in
 * place of the drawn one. Both halves are in this file, so the name a cell
 * asks for and the name a recolour sets cannot drift apart.
 */
function variablesOf(colours: readonly PaletteEntry[] | undefined): CSSProperties | undefined {
  if (colours === undefined || colours.length === 0) return undefined;
  const variables: Record<string, string> = {};
  for (const { id, hex } of colours) variables[`--c-${id}`] = hex;
  // Custom properties are valid CSS; React's types just do not list them.
  return variables as CSSProperties;
}

export interface SpriteProps {
  skin: RenderableSkin;
  /** Animation frame. Each part wraps around its own frame count. */
  frame?: number;
  /**
   * Time since the animation started, in milliseconds. When given, each part
   * shows the frame its own timeline has reached by then (every frame carries
   * its own duration), and `frame` is ignored.
   *
   * A number rather than a "playing" switch: the clock stays with the caller,
   * so the same component can be played, paused on a frame, or rendered on a
   * server, where there is no clock at all.
   */
  elapsedMs?: number;
  /**
   * Colours to wear in place of the drawn ones, by palette id. They are set as
   * CSS variables on the `<svg>`; every cell already asks for
   * `var(--c-<id>, <the colour it was drawn in>)`, so the skin's data is not
   * touched and the same skin can be on screen twice in different colours.
   *
   * Like `skin`, this is drawn as given. Whatever reaches it from a user has
   * been through `parseAppearance` on the server first.
   */
  colours?: readonly PaletteEntry[];
  className?: string;
  /** Canvas size in user units. Must match what the skin was authored at. */
  size?: number;
}

/**
 * Milliseconds since `playing` turned true, refreshed about every `tickMs`.
 * Zero while it is false. Pass the result to `<Sprite elapsedMs>`.
 */
export function useElapsedMs(playing: boolean, tickMs = 50): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    const timer = setInterval(() => setElapsed(performance.now() - start), tickMs);
    return () => {
      clearInterval(timer);
      setElapsed(0);
    };
  }, [playing, tickMs]);

  return playing ? elapsed : 0;
}

export function Sprite({ skin, frame = 0, elapsedMs, colours, className, size = 16 }: SpriteProps) {
  return (
    <svg
      className={className}
      style={variablesOf(colours)}
      viewBox={`0 0 ${size} ${size}`}
      // Without this the edges of each dot get antialiased when scaled up.
      shapeRendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {skin.parts.map((part) => {
        const frames = part.frames;
        if (frames.length === 0) return null;
        const current =
          frames[elapsedMs === undefined ? frame % frames.length : frameAt(frames, elapsedMs)];
        if (!current) return null;
        return (
          <g key={part.slot} data-part={part.slot}>
            {/* Static data, so an index key is fine — nothing reorders. */}
            {current.rects.map(([x, y, w, h, ci], i) => (
              <rect key={i} x={x} y={y} width={w} height={h} fill={fillOf(skin.palette, ci)} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
