/**
 * The grid that gets painted: one button per cell.
 *
 * It shows one part at a time. The other parts can be drawn faintly behind the
 * cells, which is what makes it possible to line a sleeve up with an arm — the
 * parts share one canvas (docs/02-sprite-format.md §スキン規格), and this is
 * where that shows.
 */

import type { CSSProperties, PointerEvent } from "react";

import { SKIN_SPEC } from "@mba/sprite";
import type { PaletteEntry, RenderableSkin } from "@mba/sprite";
import { Sprite } from "@mba/sprite-react";

import type { Grid } from "./model.js";

const frame: CSSProperties = {
  position: "relative",
  width: "20rem",
  height: "20rem",
  border: "1px solid #888",
  background: "#ffffff",
};

const ghostLayer: CSSProperties = {
  position: "absolute",
  inset: 0,
  opacity: 0.35,
  // The ghost is only there to be looked at; clicks belong to the cells.
  pointerEvents: "none",
  lineHeight: 0,
};

const cells: CSSProperties = {
  position: "relative",
  display: "grid",
  gridTemplateColumns: `repeat(${SKIN_SPEC.canvasSize}, 1fr)`,
  width: "100%",
  height: "100%",
  // Without this a touch drag scrolls the page instead of painting.
  touchAction: "none",
};

const cellBase: CSSProperties = {
  padding: 0,
  border: "1px solid rgba(0, 0, 0, 0.08)",
  borderRadius: 0,
  cursor: "crosshair",
};

export function Canvas({
  grid,
  palette,
  ghost,
  ghostFrame,
  onPaint,
}: {
  /** The part being painted, in the frame being painted. */
  grid: Grid;
  palette: readonly PaletteEntry[];
  /** The other parts, drawn faintly behind the cells. Null leaves them out. */
  ghost: RenderableSkin | null;
  ghostFrame: number;
  onPaint: (cell: number) => void;
}) {
  const startStroke = (cell: number) => (event: PointerEvent<HTMLButtonElement>) => {
    // A touch pointer is captured by the element it lands on. Released, it
    // fires pointerenter on the cells it is dragged across, as a mouse does.
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onPaint(cell);
  };

  const continueStroke = (cell: number) => (event: PointerEvent<HTMLButtonElement>) => {
    // `buttons` is 1 only while the primary button (or a finger) is down.
    if (event.buttons === 1) onPaint(cell);
  };

  return (
    <div style={frame}>
      {ghost !== null && (
        <div style={ghostLayer} data-ghost>
          <Sprite skin={ghost} frame={ghostFrame} />
        </div>
      )}
      <div style={cells} role="group" aria-label="キャンバス">
        {/* The grid never reorders, so a cell's position is a stable key. */}
        {grid.map((paletteIndex, cell) => (
          <button
            key={cell}
            type="button"
            data-colour={paletteIndex}
            aria-label={`${cell % SKIN_SPEC.canvasSize},${Math.floor(cell / SKIN_SPEC.canvasSize)}`}
            style={{
              ...cellBase,
              // An empty cell is see-through, so the ghost shows where this
              // part has nothing.
              background:
                paletteIndex === 0 ? "transparent" : (palette[paletteIndex - 1]?.hex ?? "magenta"),
            }}
            onPointerDown={startStroke(cell)}
            onPointerEnter={continueStroke(cell)}
            // Keyboard activation arrives as a click, not as a pointer event.
            onClick={() => onPaint(cell)}
          />
        ))}
      </div>
    </div>
  );
}
