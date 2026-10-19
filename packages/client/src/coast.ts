// Geometry for the shore and the map's edge: cutting a triangle where the
// ground crosses a height (so a beach ends in a smooth line instead of saw
// teeth), the waterline through a triangle, and a wavy offset for the island's
// outline. Pure functions of numbers; nothing here touches the simulation.

import { noise2 } from './art.ts';

/** A corner of a ground triangle: world position, ground height and distance from land. */
export interface Vert {
  x: number;
  y: number;
  h: number;
  d: number;
  /** A smoothed height, used where the shore is cut (defaults to h). */
  s?: number;
}

const lerpV = (a: Vert, b: Vert, t: number): Vert => {
  const v: Vert = {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    h: a.h + (b.h - a.h) * t,
    d: a.d + (b.d - a.d) * t,
  };
  if (a.s !== undefined && b.s !== undefined) v.s = a.s + (b.s - a.s) * t;
  return v;
};

export type HeightKey = 'h' | 's';
const key = (v: Vert, k: HeightKey): number => (k === 's' ? v.s ?? v.h : v.h);

/**
 * The part of a convex polygon whose height is at least `lo` and at most `hi`
 * (use -Infinity or Infinity for an open end). Height is linear across a
 * triangle, so the cut is exact. Returns [] if nothing is left.
 */
export function clipBand(poly: Vert[], lo: number, hi: number, by: HeightKey = 'h'): Vert[] {
  let out = poly;
  if (lo > -Infinity) out = clipHalf(out, (v) => key(v, by) - lo);
  if (hi < Infinity && out.length > 0) out = clipHalf(out, (v) => hi - key(v, by));
  return out;
}

/** Keep the side where `side(v) >= 0` (Sutherland-Hodgman against one line). */
function clipHalf(poly: Vert[], side: (v: Vert) => number): Vert[] {
  const out: Vert[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) out.push(lerpV(a, b, sa / (sa - sb)));
  }
  return out;
}

/** Area of a polygon (always positive). */
export function polyArea(poly: { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** The line where the ground in a triangle is exactly at height `t`, as two points, or null if it does not cross. */
export function contourSegment(a: Vert, b: Vert, c: Vert, t: number, by: HeightKey = 'h'): [{ x: number; y: number }, { x: number; y: number }] | null {
  const pts: { x: number; y: number }[] = [];
  const edge = (p: Vert, q: Vert): void => {
    const hp = key(p, by);
    const hq = key(q, by);
    if ((hp - t) * (hq - t) < 0) {
      const u = (t - hp) / (hq - hp);
      pts.push({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u });
    }
  };
  edge(a, b);
  edge(b, c);
  edge(c, a);
  return pts.length === 2 ? [pts[0]!, pts[1]!] : null;
}

/**
 * A closed outline pushed outwards by a wandering amount, so a straight map
 * edge becomes a coast. `amount` is the average push in pixels, `wave` how far it
 * wanders, `seed` picks the coast. Each point moves along the outline's outward
 * normal (the outline runs clockwise on screen, so outward is to its left).
 */
export function wavyOutline(points: { x: number; y: number }[], amount: number, wave: number, seed: number): { x: number; y: number }[] {
  const n = points.length;
  return points.map((p, i) => {
    const prev = points[(i - 1 + n) % n]!;
    const next = points[(i + 1) % n]!;
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    // clockwise on screen (y down): the outside is on the left of the direction of travel
    const nx = ty;
    const ny = -tx;
    const push = amount + wave * (noise2(i / 3.1, 0.5, seed) * 2 - 1) + wave * 0.45 * (noise2(i / 1.3, 7.5, seed + 5) * 2 - 1);
    return { x: p.x + nx * push, y: p.y + ny * push };
  });
}

/**
 * Distance, in cells, from every cell to the nearest `land` cell (0 on land),
 * by a two-pass chamfer sweep (3-4 weights, so within a few percent of the
 * true Euclidean distance). `land` is w x h, row by row.
 */
export function distanceField(land: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = land[i] ? 0 : INF;
  const A = 1; // straight step
  const B = 1.4142; // diagonal step
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? INF : d[y * w + x]!);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      d[i] = Math.min(d[i]!, at(x - 1, y) + A, at(x, y - 1) + A, at(x - 1, y - 1) + B, at(x + 1, y - 1) + B);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      d[i] = Math.min(d[i]!, at(x + 1, y) + A, at(x, y + 1) + A, at(x + 1, y + 1) + B, at(x - 1, y + 1) + B);
    }
  }
  return d;
}
