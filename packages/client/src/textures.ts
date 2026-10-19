// Ground textures, made at start-up from noise: no image files. Each is a
// seamless tile of brightness only (values around 0.6 to 1.0, near white); the
// terrain multiplies it by the colour of the polygon it covers, so the same
// grass tile serves a lush meadow and a dry steppe. The tile functions are pure
// (a pixel from its coordinates), so they are tested without a canvas.

import { clamp, hash2 } from './art.ts';

export type Ground = 'grass' | 'forest' | 'dirt' | 'sand' | 'scree' | 'rock' | 'snow' | 'water';
export const GROUNDS: readonly Ground[] = ['grass', 'forest', 'dirt', 'sand', 'scree', 'rock', 'snow', 'water'];
export const TILE = 256;

/** Value noise that repeats every `px` cells across and `py` down: seamless when the tile is TILE pixels wide. */
export function tileNoise(x: number, y: number, px: number, py: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const wrap = (n: number, p: number): number => ((n % p) + p) % p;
  const a = hash2(wrap(ix, px), wrap(iy, py), seed);
  const b = hash2(wrap(ix + 1, px), wrap(iy, py), seed);
  const c = hash2(wrap(ix, px), wrap(iy + 1, py), seed);
  const d = hash2(wrap(ix + 1, px), wrap(iy + 1, py), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Cell noise on a seamless grid of `n` x `n` jittered points: distance to the nearest and second nearest, in cells. */
export function cellular(x: number, y: number, n: number, seed: number): { f1: number; f2: number; id: number } {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = Infinity;
  let f2 = Infinity;
  let id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cy = iy + dy;
      const wx = ((cx % n) + n) % n;
      const wy = ((cy % n) + n) % n;
      const px = cx + 0.15 + 0.7 * hash2(wx, wy, seed);
      const py = cy + 0.15 + 0.7 * hash2(wx, wy, seed + 1);
      const d = Math.hypot(x - px, y - py);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash2(wx, wy, seed + 2);
      } else if (d < f2) f2 = d;
    }
  }
  return { f1, f2, id };
}

const smooth = (e0: number, e1: number, v: number): number => {
  const t = clamp((v - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Brightness (about 0.6 to 1) of one pixel of a ground tile, `x` and `y` in 0..TILE-1. */
export function groundPixel(kind: Ground, x: number, y: number): number {
  const u = x / TILE;
  const w = y / TILE;
  switch (kind) {
    case 'grass': {
      // clumps, vertical blades, speckle and the odd pale stalk
      const clump = tileNoise(u * 6, w * 6, 6, 6, 1);
      const mid = tileNoise(u * 24, w * 24, 24, 24, 2);
      const blades = tileNoise(u * 96, w * 44, 96, 44, 3);
      const grain = tileNoise(u * 128, w * 128, 128, 128, 24);
      const speck = hash2(x, y, 4);
      let v = 0.82 + 0.09 * (clump - 0.5) + 0.1 * (mid - 0.5) + 0.1 * (blades - 0.5) + 0.12 * (grain - 0.5) + 0.05 * (speck - 0.5);
      if (speck > 0.99) v += 0.1;
      return clamp(v, 0.62, 1);
    }
    case 'forest': {
      // dark ground under trees: moss patches, fallen leaves and needles as small flecks
      const moss = tileNoise(u * 8, w * 8, 8, 8, 5);
      const leaves = cellular(u * 22, w * 22, 22, 6);
      const needles = tileNoise(u * 96, w * 96, 96, 96, 7);
      let v = 0.72 + 0.16 * (moss - 0.5) + 0.2 * (needles - 0.5);
      v += (leaves.id - 0.5) * 0.16 * smooth(0.45, 0.2, leaves.f1);
      return clamp(v, 0.5, 0.95);
    }
    case 'dirt': {
      // packed earth: soft mottling, grit and small stones
      const mottle = tileNoise(u * 7, w * 7, 7, 7, 8);
      const grit = hash2(x, y, 9);
      const stones = cellular(u * 16, w * 16, 16, 10);
      let v = 0.8 + 0.14 * (mottle - 0.5) + 0.14 * (grit - 0.5);
      v -= 0.12 * smooth(0.3, 0.12, stones.f1) * (stones.id > 0.6 ? 1 : 0);
      return clamp(v, 0.55, 1);
    }
    case 'sand': {
      // wind ripples along the tile, with fine grain
      const warp = tileNoise(u * 5, w * 5, 5, 5, 11);
      const ripple = 0.5 + 0.5 * Math.sin((w * 18 + warp * 2.4) * Math.PI * 2);
      const grain = hash2(x, y, 12);
      return clamp(0.88 + 0.06 * (ripple - 0.5) + 0.1 * (grain - 0.5) + 0.05 * (tileNoise(u * 12, w * 12, 12, 12, 13) - 0.5), 0.7, 1);
    }
    case 'scree': {
      // loose gravel: pebbles of different shades with dark gaps
      const c = cellular(u * 46, w * 46, 46, 14);
      const small = cellular(u * 90, w * 90, 90, 25);
      const gap = smooth(0.06, 0.3, c.f2 - c.f1);
      return clamp((0.74 + 0.2 * c.id) * (0.78 + 0.22 * gap) + 0.06 * (small.id - 0.5) + 0.05 * (hash2(x, y, 15) - 0.5), 0.5, 1);
    }
    case 'rock': {
      // blocks split by cracks, with strata and weathering
      const c = cellular(u * 13, w * 9, 13, 16);
      const crack = smooth(0.012, 0.07, c.f2 - c.f1);
      const strata = 0.5 + 0.5 * Math.sin((w * 9 + tileNoise(u * 4, w * 4, 4, 4, 17) * 2.2) * Math.PI * 2);
      const weather = tileNoise(u * 20, w * 20, 20, 20, 18);
      const grit = tileNoise(u * 96, w * 96, 96, 96, 26);
      const v = (0.78 + 0.12 * c.id + 0.05 * (strata - 0.5)) * (0.74 + 0.26 * crack) + 0.1 * (weather - 0.5) + 0.08 * (grit - 0.5);
      return clamp(v, 0.45, 1);
    }
    case 'snow': {
      // drifts and a sparkle of crystals
      const drift = tileNoise(u * 4, w * 7, 4, 7, 19);
      const fine = tileNoise(u * 32, w * 32, 32, 32, 20);
      const sparkle = hash2(x, y, 21) > 0.992 ? 0.07 : 0;
      return clamp(0.94 + 0.05 * (drift - 0.5) + 0.04 * (fine - 0.5) + sparkle, 0.82, 1);
    }
    case 'water': {
      // long crossing ripples
      const a = tileNoise(u * 4, w * 24, 4, 24, 22);
      const b = tileNoise(u * 9, w * 40, 9, 40, 23);
      const crest = smooth(0.6, 0.95, 0.6 * a + 0.4 * b);
      const c = cellular(u * 16, w * 12, 16, 27); // caustics: a net of bright lines
      const net = 1 - smooth(0, 0.16, c.f2 - c.f1);
      return clamp(0.84 + 0.1 * crest + 0.065 * net - 0.05 * (1 - a), 0.7, 1);
    }
  }
}

/** Fill a canvas with a ground tile (browser only). */
export function paintGround(kind: Ground, canvas: HTMLCanvasElement): void {
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const v = Math.round(groundPixel(kind, x, y) * 255);
      const i = (y * TILE + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
