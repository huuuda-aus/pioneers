// The ground tiles: seamless, in range, and told apart. They are pure functions
// of the pixel, so no canvas is needed.
import { describe, expect, it } from 'vitest';
import { cellular, GROUNDS, groundPixel, TILE, tileNoise, type Ground } from '../src/textures.ts';

const mean = (kind: Ground, step = 4): number => {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < TILE; y += step) for (let x = 0; x < TILE; x += step) {
    sum += groundPixel(kind, x, y);
    n++;
  }
  return sum / n;
};
const spread = (kind: Ground, step = 3): number => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < TILE; y += step) for (let x = 0; x < TILE; x += step) {
    const v = groundPixel(kind, x, y);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return hi - lo;
};

describe('seamless noise', () => {
  it('tile noise repeats with its period', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.31;
      const y = i * 0.17;
      expect(tileNoise(x + 6, y, 6, 9, 1)).toBeCloseTo(tileNoise(x, y, 6, 9, 1), 9);
      expect(tileNoise(x, y + 9, 6, 9, 1)).toBeCloseTo(tileNoise(x, y, 6, 9, 1), 9);
    }
  });

  it('cell noise repeats too, and its distances are sane', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.23;
      const y = i * 0.41;
      const a = cellular(x, y, 7, 3);
      const b = cellular(x + 7, y + 7, 7, 3);
      expect(b.f1).toBeCloseTo(a.f1, 9);
      expect(b.f2).toBeCloseTo(a.f2, 9);
      expect(a.f2).toBeGreaterThanOrEqual(a.f1);
      expect(a.f1).toBeLessThan(1.5);
    }
  });
});

describe('every ground tile', () => {
  for (const kind of GROUNDS) {
    it(`${kind}: the same each time, inside 0..1, with texture but not noise`, () => {
      for (let i = 0; i < 300; i++) {
        const x = (i * 37) % TILE;
        const y = (i * 91) % TILE;
        const v = groundPixel(kind, x, y);
        expect(v).toBe(groundPixel(kind, x, y));
        expect(v).toBeGreaterThanOrEqual(0.3);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(spread(kind)).toBeGreaterThan(0.08); // there is something to see
      expect(spread(kind)).toBeLessThan(0.75);
    });

    it(`${kind}: no jump where the tile repeats`, () => {
      // the smooth part of the tile must meet itself: compare the row/column average across the seam
      const col = (x: number): number => {
        let s = 0;
        for (let y = 0; y < TILE; y++) s += groundPixel(kind, x, y);
        return s / TILE;
      };
      const row = (y: number): number => {
        let s = 0;
        for (let x = 0; x < TILE; x++) s += groundPixel(kind, x, y);
        return s / TILE;
      };
      expect(Math.abs(col(0) - col(TILE - 1))).toBeLessThan(0.06);
      expect(Math.abs(row(0) - row(TILE - 1))).toBeLessThan(0.06);
    });
  }

  it('brightness suits the material: snow brightest, rock and forest floor darkest', () => {
    expect(mean('snow')).toBeGreaterThan(mean('sand'));
    expect(mean('sand')).toBeGreaterThan(mean('grass'));
    expect(mean('grass')).toBeGreaterThan(mean('forest'));
    expect(mean('snow')).toBeGreaterThan(mean('rock') + 0.1);
    for (const k of GROUNDS) {
      expect(mean(k)).toBeGreaterThan(0.55);
      expect(mean(k)).toBeLessThan(1);
    }
  });

  it('rock has cracks (dark lines), snow does not', () => {
    const dark = (kind: Ground) => {
      let n = 0;
      let all = 0;
      const m = mean(kind);
      for (let y = 0; y < TILE; y += 2) for (let x = 0; x < TILE; x += 2) {
        all++;
        if (groundPixel(kind, x, y) < m - 0.18) n++;
      }
      return n / all;
    };
    expect(dark('rock')).toBeGreaterThan(0.01);
    expect(dark('snow')).toBe(0);
  });

  it('the kinds differ from one another', () => {
    const sample = (k: Ground) => Array.from({ length: 40 }, (_, i) => groundPixel(k, i * 5, i * 3).toFixed(3)).join();
    expect(new Set(GROUNDS.map(sample)).size).toBe(GROUNDS.length);
  });
});
