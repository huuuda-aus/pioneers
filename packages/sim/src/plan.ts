// Placement helpers for tools and UI. They never mutate the game.

import { DIRS, Dir, reverse } from './types.ts';
import { checkFlag, checkRoadStep, type Check } from './placement.ts';
import type { Game } from './game.ts';

/** Can a flag be added at (x, y)? `reason` says why not. */
export function checkFlagAt(game: Game, x: number, y: number): Check {
  if (!game.inside(x, y)) return { ok: false, reason: 'outside the map' };
  return checkFlag(game, game.index(x, y));
}

/** True if a flag can be added at (x, y). */
export function canPlaceFlag(game: Game, x: number, y: number): boolean {
  return checkFlagAt(game, x, y).ok;
}

/**
 * Shortest valid road from a flag to another flag standing at `toPos`
 * (fewest tiles, ties broken by direction order), or null if none exists.
 * Valid means: free tiles only, both end directions unused, and every step
 * accepted by Game.addRoad.
 */
export function planRoad(game: Game, fromFlag: number, toPos: number): Dir[] | null {
  const from = game.flags[fromFlag];
  if (!from) return null;
  const toFlag = game.flagAtPos(toPos);
  if (toFlag < 0 || toFlag === fromFlag) return null;
  const to = game.flags[toFlag]!;

  const prev = new Int32Array(game.cols * game.rows).fill(-2);
  const via = new Int8Array(game.cols * game.rows);
  const queue: number[] = [from.pos];
  prev[from.pos] = -1;
  for (let head = 0; head < queue.length; head++) {
    const pos = queue[head]!;
    for (let d = 0; d < DIRS; d++) {
      if (pos === from.pos && from.road[d]! >= 0) continue; // first step
      const next = game.move(pos, d as Dir);
      if (next < 0 || prev[next] !== -2) continue;
      if (!checkRoadStep(game, pos, next).ok) continue;
      if (next === toPos) {
        if (to.road[reverse(d as Dir)]! >= 0) continue; // last step
        const dirs: Dir[] = [d as Dir];
        for (let p = pos; p !== from.pos; p = prev[p]!) dirs.push(via[p]! as Dir);
        return dirs.reverse();
      }
      if (game.flagAtPos(next) >= 0 || game.roadAtPos(next)) continue;
      prev[next] = pos;
      via[next] = d;
      queue.push(next);
    }
  }
  return null;
}
