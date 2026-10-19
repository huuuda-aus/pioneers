// The geometry of the shore: cutting a triangle where the ground crosses a
// height, the waterline through it, and the wavy outline of the island.
import { describe, expect, it } from 'vitest';
import { clipBand, contourSegment, distanceField, polyArea, wavyOutline, type Vert } from '../src/coast.ts';

const v = (x: number, y: number, h: number, d = 0, s?: number): Vert => ({ x, y, h, d, ...(s === undefined ? {} : { s }) });
const tri = (h0: number, h1: number, h2: number): Vert[] => [v(0, 0, h0, 0), v(10, 0, h1, 2), v(0, 10, h2, 4)];
const area = (p: Vert[]) => polyArea(p);

describe('clipBand', () => {
  it('a triangle wholly inside the band comes back whole', () => {
    const t = tri(5, 6, 7);
    expect(clipBand(t, 4, 8)).toEqual(t);
    expect(area(clipBand(t, -Infinity, Infinity))).toBeCloseTo(50, 9);
  });

  it('a triangle wholly outside the band leaves nothing', () => {
    expect(clipBand(tri(5, 6, 7), 8, 9)).toEqual([]);
    expect(clipBand(tri(5, 6, 7), 0, 4)).toEqual([]);
  });

  it('the parts either side of a cut add up to the whole, and meet along the cut', () => {
    const t = tri(2, 8, 5);
    const low = clipBand(t, -Infinity, 5);
    const high = clipBand(t, 5, Infinity);
    expect(area(low) + area(high)).toBeCloseTo(area(t), 9);
    for (const p of [...low, ...high]) {
      expect(p.h).toBeGreaterThanOrEqual(2 - 1e-9);
      expect(p.h).toBeLessThanOrEqual(8 + 1e-9);
    }
    for (const p of low) expect(p.h).toBeLessThanOrEqual(5 + 1e-9);
    for (const p of high) expect(p.h).toBeGreaterThanOrEqual(5 - 1e-9);
  });

  it('three bands add up to the whole too', () => {
    const t = tri(1, 9, 4);
    const total = area(clipBand(t, -Infinity, 3)) + area(clipBand(t, 3, 6)) + area(clipBand(t, 6, Infinity));
    expect(total).toBeCloseTo(area(t), 9);
  });

  it('the cut is where the height crosses: its area follows from the linear height', () => {
    // height rises 0 -> 10 along x on a 10 x 10 right triangle: the part below 5 is the left half's triangle slice
    const t = [v(0, 0, 0), v(10, 0, 10), v(0, 10, 0)];
    const below = clipBand(t, -Infinity, 5);
    expect(area(below)).toBeCloseTo(50 - 12.5, 9); // everything left of x = 5 within the triangle
    for (const p of below) expect(p.x).toBeLessThanOrEqual(5 + 1e-9);
  });

  it('new corners carry interpolated height, distance and smoothed height', () => {
    const t = [v(0, 0, 0, 0, 0), v(10, 0, 10, 10, 20), v(0, 10, 0, 0, 0)];
    const cut = clipBand(t, 5, Infinity).filter((p) => Math.abs(p.h - 5) < 1e-9);
    expect(cut.length).toBe(2);
    for (const p of cut) {
      expect(p.x).toBeCloseTo(5, 9);
      expect(p.d).toBeCloseTo(5, 9);
      expect(p.s).toBeCloseTo(10, 9);
    }
  });

  it('can cut by the smoothed height instead', () => {
    const t = [v(0, 0, 0, 0, 10), v(10, 0, 0, 0, 0), v(0, 10, 0, 0, 0)]; // flat in h, a slope in s
    expect(area(clipBand(t, 5, Infinity))).toBe(0);
    expect(area(clipBand(t, 5, Infinity, 's'))).toBeCloseTo(12.5, 9);
  });
});

describe('contourSegment', () => {
  it('runs between the two edges the level crosses', () => {
    const seg = contourSegment(v(0, 0, 0), v(10, 0, 10), v(0, 10, 0), 5)!;
    expect(seg).not.toBeNull();
    for (const p of seg) expect(p.x).toBeCloseTo(5, 9);
    expect(Math.min(seg[0].y, seg[1].y)).toBeCloseTo(0, 9);
    expect(Math.max(seg[0].y, seg[1].y)).toBeCloseTo(5, 9);
  });

  it('is null when the triangle is all above or all below', () => {
    expect(contourSegment(v(0, 0, 6), v(10, 0, 7), v(0, 10, 8), 5)).toBeNull();
    expect(contourSegment(v(0, 0, 1), v(10, 0, 2), v(0, 10, 3), 5)).toBeNull();
  });

  it('lies on the edge of the clipped parts', () => {
    const t = tri(2, 8, 5);
    const seg = contourSegment(t[0]!, t[1]!, t[2]!, 5.5)!;
    const high = clipBand(t, 5.5, Infinity).filter((p) => Math.abs(p.h - 5.5) < 1e-9);
    for (const p of seg) expect(high.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9)).toBe(true);
  });
});

describe('wavyOutline', () => {
  // a square, clockwise on screen (y down): top edge left to right, down the right, back along the bottom, up the left
  const square: { x: number; y: number }[] = [];
  for (let i = 0; i < 10; i++) square.push({ x: i * 10, y: 0 });
  for (let i = 0; i < 10; i++) square.push({ x: 100, y: i * 10 });
  for (let i = 0; i < 10; i++) square.push({ x: 100 - i * 10, y: 100 });
  for (let i = 0; i < 10; i++) square.push({ x: 0, y: 100 - i * 10 });
  const cx = 50;
  const cy = 50;

  it('pushes the outline outwards', () => {
    const out = wavyOutline(square, 30, 0, 1);
    let farther = 0;
    for (let i = 0; i < square.length; i++) {
      const before = Math.hypot(square[i]!.x - cx, square[i]!.y - cy);
      const after = Math.hypot(out[i]!.x - cx, out[i]!.y - cy);
      if (after > before) farther++;
    }
    expect(farther).toBeGreaterThan(square.length * 0.9);
  });

  it('with no wave it is a clean offset, with a wave it wanders', () => {
    const flat = wavyOutline(square, 20, 0, 3);
    expect(flat[5]!.y).toBeCloseTo(-20, 9); // the top edge moved straight up
    const wavy = wavyOutline(square, 20, 12, 3);
    const ys = [2, 3, 4, 5, 6, 7].map((i) => wavy[i]!.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1);
    for (const y of ys) expect(y).toBeLessThan(-20 + 12 * 1.45 + 1e-6);
  });

  it('is the same every time and differs with the seed', () => {
    expect(wavyOutline(square, 20, 12, 3)).toEqual(wavyOutline(square, 20, 12, 3));
    expect(wavyOutline(square, 20, 12, 3)).not.toEqual(wavyOutline(square, 20, 12, 4));
  });

  it('keeps every point', () => {
    expect(wavyOutline(square, 5, 5, 1).length).toBe(square.length);
  });
});

describe('distanceField', () => {
  const grid = (w: number, h: number, land: [number, number][]): Uint8Array => {
    const a = new Uint8Array(w * h);
    for (const [x, y] of land) a[y * w + x] = 1;
    return a;
  };

  it('is 0 on land and grows away from it', () => {
    const d = distanceField(grid(9, 9, [[4, 4]]), 9, 9);
    expect(d[4 * 9 + 4]).toBe(0);
    expect(d[4 * 9 + 5]).toBeCloseTo(1, 5);
    expect(d[4 * 9 + 7]).toBeCloseTo(3, 5);
    expect(d[0]).toBeGreaterThan(d[1 * 9 + 1]!);
  });

  it('is close to the true distance from a point (within a few percent), whatever the direction', () => {
    const w = 61;
    const d = distanceField(grid(w, w, [[30, 30]]), w, w);
    for (const [x, y] of [[30, 5], [55, 30], [48, 48], [10, 20], [3, 57], [30 + 7, 30 + 24]] as const) {
      const exact = Math.hypot(x - 30, y - 30);
      expect(Math.abs(d[y * w + x]! - exact) / exact).toBeLessThan(0.09);
    }
  });

  it('measures to the nearest of several land cells', () => {
    const w = 40;
    const d = distanceField(grid(w, 5, [[0, 2], [39, 2]]), w, 5);
    expect(d[2 * w + 20]).toBeGreaterThan(18);
    expect(d[2 * w + 20]).toBeLessThan(21);
    expect(d[2 * w + 3]).toBeCloseTo(3, 5);
    expect(d[2 * w + 36]).toBeCloseTo(3, 5);
  });

  it('is zero everywhere on a map that is all land, and huge on one with none', () => {
    expect(Math.max(...distanceField(new Uint8Array(16).fill(1), 4, 4))).toBe(0);
    expect(Math.min(...distanceField(new Uint8Array(16), 4, 4))).toBeGreaterThan(1e6);
  });
});
