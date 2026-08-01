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

import type { PaletteEntry, RenderableSkin } from "@mba/sprite";

function fillOf(palette: PaletteEntry[], index: number): string {
  const entry = palette[index - 1];
  if (!entry) return "magenta"; // out of range = corrupt data; make it obvious
  // Same shape the exporter emits: a CSS variable with the authored colour as
  // fallback, so a colour can be overridden from outside without touching data.
  return `var(--c-${entry.id}, ${entry.hex})`;
}

export interface SpriteProps {
  skin: RenderableSkin;
  /** Animation frame. Each part wraps around its own frame count. */
  frame?: number;
  className?: string;
  /** Canvas size in user units. Must match what the skin was authored at. */
  size?: number;
}

export function Sprite({ skin, frame = 0, className, size = 16 }: SpriteProps) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${size} ${size}`}
      // Without this the edges of each dot get antialiased when scaled up.
      shapeRendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {skin.parts.map((part) => {
        const frames = part.frames;
        if (frames.length === 0) return null;
        const current = frames[frame % frames.length];
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
