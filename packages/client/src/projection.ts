// Map point <-> screen. Isometric look: the sim's skewed hex grid is squashed
// vertically, and each point is lifted by its terrain height.
//
// Neighbours of the sim grid are Right (1,0), DownRight (1,1), Down (0,1):
// x runs along a row, y steps down and half a cell to the left, so every
// neighbour sits at the same distance before squashing.
import type { Game } from '@sett/sim';
import { MAX_HEIGHT } from '@sett/sim';

export const S = 64; // horizontal distance between neighbouring points, world px
export const Y_SQUASH = 0.58; // vertical squash that makes it look isometric
export const ROW_H = ((S * Math.sqrt(3)) / 2) * Y_SQUASH; // world px between rows
export const HEIGHT_PX = 4.2; // world px of lift per height unit

export interface Pt {
  x: number;
  y: number;
}

/** Ground position of a map point: grid coordinates plus height. */
export const toWorld = (x: number, y: number, h = 0): Pt => ({
  x: (x - y / 2) * S,
  y: y * ROW_H - h * HEIGHT_PX,
});

/** Where a point would be on a level plain: the depth-sorting key. */
export const flatY = (y: number): number => y * ROW_H;

export function posToWorld(game: Game, pos: number): Pt {
  return toWorld(pos % game.cols, Math.floor(pos / game.cols), game.terrain.heightAt(pos));
}

/**
 * The map point under a world position, if one is close enough. Heights move
 * points up the screen, so a point's true row is at or below where a flat map
 * would put it; candidates are scanned down from there and the nearest wins,
 * the one in front on ties.
 */
export function pickHex(game: Game, wx: number, wy: number): { x: number; y: number } | null {
  const lift = Math.ceil((MAX_HEIGHT * HEIGHT_PX) / ROW_H) + 1;
  const y0 = Math.floor(wy / ROW_H);
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (let y = Math.max(0, y0 - 1); y <= Math.min(game.rows - 1, y0 + lift); y++) {
    const xf = wx / S + y / 2;
    for (let x = Math.floor(xf) - 1; x <= Math.floor(xf) + 2; x++) {
      if (!game.inside(x, y)) continue;
      const p = posToWorld(game, game.index(x, y));
      const d = Math.hypot((p.x - wx) * 0.9, (p.y - wy) * 1.6);
      const score = d - y * 0.01;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return bestScore <= S * 0.45 ? best : null;
}

/** World-space bounds of the whole map (for fitting the camera). */
export function gridBounds(game: Game): { minX: number; minY: number; maxX: number; maxY: number } {
  const lo = toWorld(0, game.rows - 1);
  const hi = toWorld(game.cols - 1, 0);
  return {
    minX: lo.x - S,
    minY: -MAX_HEIGHT * HEIGHT_PX - S,
    maxX: hi.x + S,
    maxY: lo.y + S,
  };
}
