// Level of detail for a zoomed-out map. Zoomed far out the whole map is on screen and everything is a few pixels
// big, so the full pictures (a tree is ~30 shapes, a building dozens) are wasted effort; these are the cheap
// stand-ins. All pure drawing, same conventions as buildings.ts so the tests can run them on a recording canvas.

import type { Graphics } from 'pixi.js';
import { leafColors, scaleColor, type Species } from './art.ts';

export type Lod = 'near' | 'far';

/** Below this zoom (world.scale) the map is drawn the cheap way. */
export const LOD_FAR = 0.5;
/** It switches back to full detail only this far above the threshold, so a zoom resting on it does not flicker. */
export const LOD_HYSTERESIS = 0.05;

export function lodOf(scale: number, previous: Lod = 'near'): Lod {
  if (previous === 'far') return scale >= LOD_FAR + LOD_HYSTERESIS ? 'near' : 'far';
  return scale < LOD_FAR ? 'far' : 'near';
}

/** A whole stand of trees as two shapes: a dark crown with a lighter one on it. */
export function drawFarTrees(g: Graphics, x: number, y: number, species: Species, v: number): void {
  const { dark, light } = leafColors(species, v);
  g.ellipse(x, y - 8, 24, 17).fill({ color: dark });
  g.circle(x - 4, y - 12, 10).fill({ color: light });
}

/** A rock as one shape. */
export function drawFarRock(g: Graphics, x: number, y: number, units: number): void {
  const r = 6 + units;
  g.ellipse(x, y - r * 0.3, r * 1.1, r * 0.7).fill({ color: 0x7d7f82 });
}

/**
 * A building as a plain block: lit wall, shaded wall and roof, in the building's colour (`w` is the footprint
 * width, `h` the wall height, as for the full art). A site is the same block, see-through.
 */
export function drawBuildingFar(g: Graphics, cx: number, cy: number, w: number, h: number, color: number, progress = 1): void {
  const a = progress < 1 ? 0.55 : 1;
  const hw = w / 2;
  const q = w / 4;
  g.poly([cx - hw, cy, cx, cy + q, cx, cy + q - h, cx - hw, cy - h]).fill({ color: scaleColor(color, 1.05), alpha: a });
  g.poly([cx + hw, cy, cx, cy + q, cx, cy + q - h, cx + hw, cy - h]).fill({ color: scaleColor(color, 0.72), alpha: a });
  g.poly([cx - hw, cy - h, cx, cy - h - q, cx + hw, cy - h, cx, cy - h + q]).fill({ color: scaleColor(color, 1.3), alpha: a });
}
