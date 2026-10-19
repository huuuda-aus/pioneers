// The shape of a road: a smooth curve, edges that wander but stay on their sides.
import { describe, expect, it } from 'vitest';
import { blob, outline, resample, roadMesh, smoothPath, type P } from '../src/roads.ts';

const stairs: P[] = [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 96, y: 28 }, { x: 160, y: 28 }, { x: 192, y: 0 }, { x: 256, y: 0 }];
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

describe('resample', () => {
  it('passes through every point of the path and keeps both ends', () => {
    const s = resample(stairs, 5);
    expect(s[0]!.p).toEqual(stairs[0]);
    expect(s[s.length - 1]!.p).toEqual(stairs[stairs.length - 1]);
    for (let i = 0; i < stairs.length; i++) {
      const near = s.find((q) => Math.abs(q.u - i) < 1e-9)!;
      expect(near).toBeDefined();
      expect(dist(near.p, stairs[i]!)).toBeLessThan(1e-6);
    }
  });

  it('is evenly spaced, roughly', () => {
    const s = resample(stairs, 5);
    for (let i = 1; i < s.length; i++) expect(dist(s[i]!.p, s[i - 1]!.p)).toBeLessThan(9);
  });

  it('takes the corners off: no sharp turn left in the curve', () => {
    const s = resample(stairs, 4).map((q) => q.p);
    let sharpest = 0;
    for (let i = 1; i + 1 < s.length; i++) {
      const a = { x: s[i]!.x - s[i - 1]!.x, y: s[i]!.y - s[i - 1]!.y };
      const b = { x: s[i + 1]!.x - s[i]!.x, y: s[i + 1]!.y - s[i]!.y };
      const turn = Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));
      sharpest = Math.max(sharpest, turn);
    }
    expect(sharpest).toBeLessThan(0.5); // the path itself turns 0.8 radians at its corners
  });

  it('copes with one point, two points and none', () => {
    expect(resample([], 5)).toEqual([]);
    expect(resample([{ x: 1, y: 2 }], 5).length).toBe(1);
    expect(resample([{ x: 0, y: 0 }, { x: 10, y: 0 }], 5).length).toBeGreaterThanOrEqual(2);
  });
});

describe('roadMesh', () => {
  const m = roadMesh(stairs, 3);

  it('has an edge on each side of the centre line, at its own width', () => {
    for (let i = 0; i < m.c.length; i++) {
      expect(dist(m.l[i]!, m.c[i]!)).toBeCloseTo(m.wl[i]!, 6);
      expect(dist(m.r[i]!, m.c[i]!)).toBeCloseTo(m.wr[i]!, 6);
      // opposite sides of the line
      const cross = (m.l[i]!.x - m.c[i]!.x) * (m.r[i]!.x - m.c[i]!.x) + (m.l[i]!.y - m.c[i]!.y) * (m.r[i]!.y - m.c[i]!.y);
      expect(cross).toBeLessThan(0);
    }
  });

  it('widths stay in a sensible range and are not all the same', () => {
    const all = [...m.wl, ...m.wr];
    expect(Math.min(...all)).toBeGreaterThanOrEqual(1.8);
    expect(Math.max(...all)).toBeLessThan(5.2 + 3 * 1.2);
    expect(Math.max(...all) - Math.min(...all)).toBeGreaterThan(1.5);
  });

  it('the two edges differ: the road is not symmetric', () => {
    let diff = 0;
    for (let i = 0; i < m.c.length; i++) diff += Math.abs(m.wl[i]! - m.wr[i]!);
    expect(diff / m.c.length).toBeGreaterThan(0.4);
  });

  it('the width changes smoothly from one sample to the next (wobble, not jitter)', () => {
    for (let i = 1; i < m.c.length; i++) {
      expect(Math.abs(m.wl[i]! - m.wl[i - 1]!)).toBeLessThan(2.2);
      expect(Math.abs(m.wr[i]! - m.wr[i - 1]!)).toBeLessThan(2.2);
    }
  });

  it('normals are unit length and square to the direction of travel', () => {
    for (let i = 1; i + 1 < m.c.length; i++) {
      expect(Math.hypot(m.n[i]!.x, m.n[i]!.y)).toBeCloseTo(1, 6);
      const tx = m.c[i + 1]!.x - m.c[i - 1]!.x;
      const ty = m.c[i + 1]!.y - m.c[i - 1]!.y;
      expect(Math.abs(tx * m.n[i]!.x + ty * m.n[i]!.y) / Math.hypot(tx, ty)).toBeLessThan(1e-6);
    }
  });

  it('is the same every time and differs with the seed', () => {
    expect(roadMesh(stairs, 3)).toEqual(roadMesh(stairs, 3));
    expect(roadMesh(stairs, 3).wl).not.toEqual(roadMesh(stairs, 4).wl);
  });

  it('a straight road to the east has its left edge on top (y down)', () => {
    const east = roadMesh([{ x: 0, y: 0 }, { x: 100, y: 0 }], 1);
    for (let i = 1; i + 1 < east.c.length; i++) {
      expect(east.l[i]!.y).toBeLessThan(east.c[i]!.y);
      expect(east.r[i]!.y).toBeGreaterThan(east.c[i]!.y);
    }
  });

  it('u runs from the first point to the last', () => {
    expect(m.u[0]).toBe(0);
    expect(m.u[m.u.length - 1]).toBe(stairs.length - 1);
    for (let i = 1; i < m.u.length; i++) expect(m.u[i]!).toBeGreaterThan(m.u[i - 1]! - 1e-9);
  });
});

describe('outline and blob', () => {
  it('the outline is the left edge out and the right edge back, and grows with `grow`', () => {
    const m = roadMesh(stairs, 2);
    const o = outline(m);
    expect(o.length).toBe(m.c.length * 4);
    expect(o[0]).toBeCloseTo(m.l[0]!.x, 9);
    expect(o[o.length - 2]).toBeCloseTo(m.r[0]!.x, 9);
    const wide = outline(m, 3);
    expect(Math.hypot(wide[0]! - m.c[0]!.x, wide[1]! - m.c[0]!.y)).toBeCloseTo(m.wl[0]! + 3, 6);
  });

  it('a blob is uneven but stays round enough, and is the same each time', () => {
    const b = blob(100, 50, 10, 5, 7);
    expect(b.length).toBe(28);
    const radii: number[] = [];
    for (let i = 0; i < b.length; i += 2) radii.push(Math.hypot((b[i]! - 100) / 10, (b[i + 1]! - 50) / 5));
    expect(Math.min(...radii)).toBeGreaterThan(0.7);
    expect(Math.max(...radii)).toBeLessThan(1.25);
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.1);
    expect(blob(100, 50, 10, 5, 7)).toEqual(b);
  });
});

describe('smoothPath', () => {
  it('has k samples to a step, passes through every point and ends where the path ends', () => {
    const k = 4;
    const s = smoothPath(stairs, k);
    expect(s.length).toBe((stairs.length - 1) * k + 1);
    for (let i = 0; i < stairs.length; i++) expect(dist(s[i * k]!, stairs[i]!)).toBeLessThan(1e-9);
    expect(s[s.length - 1]).toEqual(stairs[stairs.length - 1]);
  });

  it('cuts the corners but stays close to the path', () => {
    const s = smoothPath(stairs, 8);
    // the corner at (96, 28) is rounded: the curve near it is inside the angle, within a few pixels of the corner
    let nearest = Infinity;
    for (const p of s) nearest = Math.min(nearest, dist(p, { x: 96, y: 28 }));
    expect(nearest).toBeLessThan(1e-9); // it still passes through the point itself
    for (const p of s) {
      // never far from the chord path
      let best = Infinity;
      for (let i = 0; i + 1 < stairs.length; i++) {
        const a = stairs[i]!;
        const b = stairs[i + 1]!;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2)));
        best = Math.min(best, dist(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
      }
      expect(best).toBeLessThan(8);
    }
  });

  it('copes with a path of one or no points', () => {
    expect(smoothPath([], 4)).toEqual([]);
    expect(smoothPath([{ x: 3, y: 4 }], 4)).toEqual([{ x: 3, y: 4 }]);
  });
});
