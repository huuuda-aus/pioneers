// Terrain: one integer height per map point. What a point is (water, grass,
// mountain) is derived from its height, so height is the only stored truth.
//
// Terrain and placement live only in this TypeScript sim; the C++ reference
// covers the logistics economy, which flat terrain leaves untouched.

export enum Terrain { Water, Grass, Mountain }

export const SEA_LEVEL = 4; // points at or below are water (and flat)
export const MOUNTAIN_LEVEL = 15; // points at or above are mountain
export const MAX_HEIGHT = 31;
export const FLAT_HEIGHT = 8; // default grass height

export const classify = (h: number): Terrain =>
  h <= SEA_LEVEL ? Terrain.Water : h >= MOUNTAIN_LEVEL ? Terrain.Mountain : Terrain.Grass;

/**
 * Distance in steps between two points of the grid. Neighbours are
 * (1,0) (1,1) (0,1) (-1,0) (-1,-1) (0,-1), hence the |dx - dy| term.
 */
export const hexDistance = (dx: number, dy: number): number =>
  Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dx - dy));

export class TerrainMap {
  readonly cols: number;
  readonly rows: number;
  readonly height: Uint8Array;

  constructor(cols: number, rows: number, height?: Uint8Array) {
    this.cols = cols;
    this.rows = rows;
    this.height = height ?? new Uint8Array(cols * rows).fill(FLAT_HEIGHT);
    if (this.height.length !== cols * rows) throw new Error('height map size mismatch');
  }

  /** A level grass plain: what a game gets when no terrain is given. */
  static flat(cols: number, rows: number, h = FLAT_HEIGHT): TerrainMap {
    return new TerrainMap(cols, rows, new Uint8Array(cols * rows).fill(h));
  }

  heightAt(pos: number): number {
    return this.height[pos]!;
  }

  kindAt(pos: number): Terrain {
    return classify(this.height[pos]!);
  }

  setHeight(pos: number, h: number): void {
    this.height[pos] = Math.max(0, Math.min(MAX_HEIGHT, Math.round(h)));
  }
}

// ---- generation --------------------------------------------------------

/** Integer hash of a lattice point, uniform in [0, 1). */
export function hash01(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1): bilinear between hashed lattice corners. */
export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash01(ix, iy, seed);
  const b = hash01(ix + 1, iy, seed);
  const c = hash01(ix, iy + 1, seed);
  const d = hash01(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export interface GenerateOptions {
  cols: number;
  rows: number;
  seed: number;
  /** Feature size in tiles of the broadest hills. */
  scale?: number;
  /** Share of points that are water (default 0.10). */
  water?: number;
  /** Share of points that are mountain (default 0.20). */
  mountain?: number;
}

/**
 * Rolling hills with lakes and mountain ranges. Points are ranked by smooth
 * noise and given heights by rank, so every seed has the same mix of water,
 * grass and mountain; only where they lie differs. Same options, same map:
 * the arithmetic is integer hashing plus float operations that are exact
 * across engines.
 */
export function generateTerrain(opts: GenerateOptions): TerrainMap {
  const { cols, rows, seed } = opts;
  const scale = opts.scale ?? 16;
  const waterShare = opts.water ?? 0.1;
  const mountainShare = opts.mountain ?? 0.2;
  const count = cols * rows;

  const noise = new Float64Array(count);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // Undo the grid's skew so features are not sheared on screen.
      const wx = x - y / 2;
      const wy = y * 0.866;
      noise[y * cols + x] =
        0.55 * valueNoise(wx / scale, wy / scale, seed) +
        0.3 * valueNoise(wx / (scale / 2), wy / (scale / 2), seed + 1) +
        0.15 * valueNoise(wx / (scale / 4), wy / (scale / 4), seed + 2);
    }
  }

  // Rank, ties broken by position so the order is fully determined.
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => noise[a]! - noise[b]! || a - b);
  const t = new TerrainMap(cols, rows);
  const waterEnd = waterShare;
  const grassEnd = 1 - mountainShare;
  for (let r = 0; r < count; r++) {
    const q = r / count; // 0 = lowest point, 1 = highest
    let h: number;
    if (q < waterEnd) h = SEA_LEVEL; // water is flat
    else if (q < grassEnd) {
      // grass climbs from just above the shore to just below the mountains
      h = SEA_LEVEL + 1 + ((q - waterEnd) / (grassEnd - waterEnd)) * (MOUNTAIN_LEVEL - SEA_LEVEL - 2);
    } else {
      h = MOUNTAIN_LEVEL + ((q - grassEnd) / mountainShare) * (MAX_HEIGHT - MOUNTAIN_LEVEL - 3);
    }
    t.setHeight(order[r]!, h);
  }
  return t;
}

/**
 * Level the ground around (cx, cy) to height `h` within `radius` steps and
 * ease it back into the surrounding terrain over `blend` more steps, so the
 * start area is flat without a cliff edge.
 */
export function flattenArea(t: TerrainMap, cx: number, cy: number, radius: number, h: number, blend = 4): void {
  for (let y = 0; y < t.rows; y++) {
    for (let x = 0; x < t.cols; x++) {
      const d = hexDistance(x - cx, y - cy);
      if (d > radius + blend) continue;
      const pos = y * t.cols + x;
      if (d <= radius) t.setHeight(pos, h);
      else {
        const k = (d - radius) / (blend + 1); // 0 near the flat area, 1 outside
        t.setHeight(pos, h + (t.height[pos]! - h) * k);
      }
    }
  }
}
