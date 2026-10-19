// Colours and cosmetic noise for the landscape: grass, rock and snow, shallow
// and deep water, the species of a tree. Pure functions of numbers, so they are
// the same every frame and can be tested without a canvas. Nothing here
// touches the simulation.

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function scaleColor(c: number, k: number): number {
  const r = clamp(Math.round(((c >> 16) & 0xff) * k), 0, 255);
  const g = clamp(Math.round(((c >> 8) & 0xff) * k), 0, 255);
  const b = clamp(Math.round((c & 0xff) * k), 0, 255);
  return (r << 16) | (g << 8) | b;
}

export function lerpColor(a: number, b: number, t: number): number {
  const u = clamp(t, 0, 1);
  const ch = (shift: number) => Math.round(((a >> shift) & 0xff) * (1 - u) + ((b >> shift) & 0xff) * u);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Perceived brightness, 0 to 255. */
export const luma = (c: number): number => 0.299 * ((c >> 16) & 0xff) + 0.587 * ((c >> 8) & 0xff) + 0.114 * (c & 0xff);

/** Integer hash of a lattice point, uniform in [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1): bilinear between hashed lattice corners. */
export function noise2(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Two octaves of noise: broad patches with a little fine grain. */
export const fbm2 = (x: number, y: number, seed = 0): number => 0.7 * noise2(x, y, seed) + 0.3 * noise2(x * 2.7, y * 2.7, seed + 17);

// ---- palettes ------------------------------------------------------------

export const LAND = {
  grassMeadow: 0x6fb04a, // low, lush
  grassDry: 0xa3b556, // high and sunny
  grassDeep: 0x3f8a3c, // under forests, shady patches
  sand: 0xe0cf94,
  wetSand: 0xc9b87c,
  rockWarm: 0x8e7b69,
  rockCool: 0x7b7f86,
  rockDark: 0x4e4a49,
  snow: 0xf4f7fb,
  snowShade: 0xc3d0e2,
  shallow: 0x58b6d9,
  mid: 0x2f8ac4,
  deep: 0x1b4f93,
} as const;

/** Light from the north-west: slopes facing it are bright, the far side dark. 1 on level ground. */
export const slopeLight = (eastRise: number, southRise: number, strength = 0.09): number =>
  clamp(1 + strength * (eastRise * 0.6 + southRise * 0.8), 0.5, 1.45);

/** Grass: height sets dry or lush, noise sets patches of deeper green. `n` and `m` are noise in [0, 1). */
export function grassColor(height: number, n: number, m: number): number {
  const base = lerpColor(LAND.grassMeadow, LAND.grassDry, clamp((height - 5) / 10, 0, 1));
  const patch = lerpColor(base, LAND.grassDeep, clamp((n - 0.45) * 1.6, 0, 0.7));
  return scaleColor(patch, 0.94 + 0.12 * m);
}

/**
 * Rock and snow. `height` is the surface height (mountains start at 15),
 * `steep` the slope in height units per step. Snow settles high up and slides
 * off steep faces; strata and patches vary the rock.
 */
export function rockColor(height: number, steep: number, n: number, m: number): number {
  const rock = lerpColor(lerpColor(LAND.rockWarm, LAND.rockCool, n), LAND.rockDark, clamp(steep / 9, 0, 0.55));
  const strata = 0.95 + 0.06 * Math.sin(height * 1.9 + n * 6);
  const bare = scaleColor(rock, strata * (0.94 + 0.12 * m));
  return lerpColor(bare, lerpColor(LAND.snowShade, LAND.snow, m), snowAmount(height, steep));
}

/** How snowy a rock surface is, 0 to 1: it settles high up and slides off steep faces. */
export const snowAmount = (height: number, steep: number): number => clamp((height - 21) / 6, 0, 1) * clamp(1.15 - steep / 6, 0, 1);

/** Bare earth: brown, a little redder when dry (`dry` 0 to 1). */
export const dirtColor = (dry: number, m: number): number => scaleColor(lerpColor(0x7d6045, 0xa6835a, dry), 0.94 + 0.12 * m);

/** The floor of a forest: dark, mossy. `moss` in [0, 1) picks greener or browner. */
export const forestFloorColor = (moss: number): number => lerpColor(0x4a5a2c, 0x5b4a2e, moss);

/** Gravel on the lower slopes: grey-brown. */
export const screeColor = (n: number, m: number): number => scaleColor(lerpColor(0x8d8479, 0x77746f, n), 0.92 + 0.14 * m);

/** Beach sand, wetter nearer the water. `wet` is 0 (dry) to 1 (at the water). */
export const sandColor = (wet: number, m: number): number => scaleColor(lerpColor(LAND.sand, LAND.wetSand, wet), 0.96 + 0.08 * m);

/** Water by depth: `depth` is steps from the nearest land, 0 at the shore. Deeper is darker. */
export function waterColor(depth: number, n: number): number {
  const d = clamp(depth / 7, 0, 1);
  const base = d < 0.4 ? lerpColor(LAND.shallow, LAND.mid, d / 0.4) : lerpColor(LAND.mid, LAND.deep, (d - 0.4) / 0.6);
  return scaleColor(base, 0.96 + 0.1 * n);
}

/** The open sea by distance from the island in world pixels: turquoise at the beach, down to deep navy far out. `n` in [0, 1) mottles it. */
export const SEA_STOPS: readonly [number, number][] = [
  [0, 0x58b6d9],
  [70, 0x4aa3cf],
  [160, 0x2f8ac4],
  [290, 0x2477b0],
  [460, 0x1b5a95],
  [740, 0x1a4474],
  [1100, 0x16324f],
];
export function seaColor(dist: number, n: number): number {
  const d = clamp(dist, 0, SEA_STOPS[SEA_STOPS.length - 1]![0]);
  let i = 0;
  while (i < SEA_STOPS.length - 2 && d > SEA_STOPS[i + 1]![0]) i++;
  const [d0, c0] = SEA_STOPS[i]!;
  const [d1, c1] = SEA_STOPS[i + 1]!;
  const t = (d - d0) / (d1 - d0);
  const base = lerpColor(c0, c1, t * t * (3 - 2 * t));
  // gentle swells running parallel to the coast, strongest near it, and broad mottling
  const swell = Math.sin(dist / 24 + n * 6) * 0.045 * clamp(1 - dist / 900, 0, 1);
  return scaleColor(base, 0.97 + 0.07 * (n - 0.5) + swell);
}

// ---- trees ---------------------------------------------------------------

export type Species = 'pine' | 'oak' | 'birch';

/**
 * Which tree grows at a point. Species come in stands: broad noise picks the
 * region (pines on the higher, colder ground, oaks low, birches in between),
 * a little per-point chance mixes them at the edges.
 */
export function speciesAt(x: number, y: number, height: number, seed = 0): Species {
  const region = noise2(x / 9, y / 9, seed + 41) + (height - 8) * 0.035 + (hash2(x, y, seed + 43) - 0.5) * 0.28;
  return region > 0.62 ? 'pine' : region < 0.4 ? 'oak' : 'birch';
}

/** Leaf colours of a species, dark side and sunny side, varied by `v` in [0, 1). */
export function leafColors(species: Species, v: number): { dark: number; light: number } {
  switch (species) {
    case 'pine':
      return { dark: lerpColor(0x1f4f33, 0x2a5f3a, v), light: lerpColor(0x347a49, 0x4a9358, v) };
    case 'oak':
      return { dark: lerpColor(0x336d2c, 0x44802f, v), light: lerpColor(0x5fa13d, 0x7cb948, v) };
    case 'birch':
      return { dark: lerpColor(0x6a9a38, 0x7fa83c, v), light: lerpColor(0xa4cc55, 0xc2d95e, v) };
  }
}
