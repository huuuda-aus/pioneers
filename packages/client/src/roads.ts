// The shape of a road on the ground: the path of map points becomes a smooth
// curve, and its two edges wander in and out, so a road looks worn into the
// land and not ruled across it. Pure geometry; the drawing is in view.ts.

import { noise2 } from './art.ts';

export interface P {
  x: number;
  y: number;
}

export interface RoadMesh {
  /** The centre line, evenly spaced. */
  c: P[];
  /** Unit normals (pointing to the left of the direction of travel). */
  n: P[];
  /** The two edges. */
  l: P[];
  r: P[];
  /** Half widths to the left and to the right at each sample. */
  wl: number[];
  wr: number[];
  /** Position along the original path, as a fractional index into its points. */
  u: number[];
}

/** A smooth curve through the points (Catmull-Rom), sampled about every `step` pixels. Keeps the first and last point. */
export function resample(pts: P[], step: number): { p: P; u: number }[] {
  if (pts.length === 0) return [];
  if (pts.length === 1) return [{ p: { ...pts[0]! }, u: 0 }];
  const out: { p: P; u: number }[] = [];
  const at = (i: number): P => pts[Math.max(0, Math.min(pts.length - 1, i))]!;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const n = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ p: { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) }, u: i + t });
    }
  }
  out.push({ p: { ...pts[pts.length - 1]! }, u: pts.length - 1 });
  return out;
}

/**
 * The mesh of a road along `pts`. `base` is the usual half width in pixels;
 * each edge wanders around it by up to about `wander` (slow bends and quick
 * bumps), independently, so the road is never the same width twice.
 */
export function roadMesh(pts: P[], seed: number, base = 5.2, wander = 3, step = 5): RoadMesh {
  const s = resample(pts, step);
  const c = s.map((q) => q.p);
  const n: P[] = [];
  const l: P[] = [];
  const r: P[] = [];
  const wl: number[] = [];
  const wr: number[] = [];
  let arc = 0;
  for (let i = 0; i < c.length; i++) {
    if (i > 0) arc += Math.hypot(c[i]!.x - c[i - 1]!.x, c[i]!.y - c[i - 1]!.y);
    const a = c[Math.max(0, i - 1)]!;
    const b = c[Math.min(c.length - 1, i + 1)]!;
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const nx = ty;
    const ny = -tx; // left of the way we are going, with y pointing down the screen
    n.push({ x: nx, y: ny });
    const wob = (side: number): number =>
      wander * 0.75 * (noise2(arc / 26, side * 7.3, seed + side) * 2 - 1) + wander * 0.4 * (noise2(arc / 7, side * 3.1 + 40, seed + 9 + side) * 2 - 1);
    const hl = Math.max(1.8, base + wob(1));
    const hr = Math.max(1.8, base + wob(2));
    wl.push(hl);
    wr.push(hr);
    l.push({ x: c[i]!.x + nx * hl, y: c[i]!.y + ny * hl });
    r.push({ x: c[i]!.x - nx * hr, y: c[i]!.y - ny * hr });
  }
  return { c, n, l, r, wl, wr, u: s.map((q) => q.u) };
}

/** A closed outline of the road, optionally wider all round by `grow` pixels, as a flat list for a polygon. */
export function outline(m: RoadMesh, grow = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < m.c.length; i++) out.push(m.c[i]!.x + m.n[i]!.x * (m.wl[i]! + grow), m.c[i]!.y + m.n[i]!.y * (m.wl[i]! + grow));
  for (let i = m.c.length - 1; i >= 0; i--) out.push(m.c[i]!.x - m.n[i]!.x * (m.wr[i]! + grow), m.c[i]!.y - m.n[i]!.y * (m.wr[i]! + grow));
  return out;
}

/** An uneven blob round a point (a worn patch at a flag), as a flat polygon list. */
export function blob(x: number, y: number, rx: number, ry: number, seed: number, points = 14): number[] {
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const k = 0.78 + 0.4 * noise2(Math.cos(a) * 1.7 + 5, Math.sin(a) * 1.7 + 5, seed);
    out.push(x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k);
  }
  return out;
}

/** The path as a smooth curve with `k` samples to each step (and the last point), passing through every original point. */
export function smoothPath(pts: P[], k: number): P[] {
  if (pts.length < 2) return pts.map((p) => ({ ...p }));
  const out: P[] = [];
  const at = (i: number): P => pts[Math.max(0, Math.min(pts.length - 1, i))]!;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push({ ...pts[pts.length - 1]! });
  return out;
}
