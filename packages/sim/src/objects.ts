// Things that stand on the map: trees to fell and rocks to chip.
//
// Like terrain, this layer lives only in the TypeScript sim. A game without
// objects (`game.objects === null`) has unlimited resources, which is what the
// C++ parity scenarios model; with objects, lumberjacks and stonecutters need
// something in range to harvest.

import { Terrain, hash01, hexDistance, valueNoise, type TerrainMap } from './terrain.ts';
import { BuildingType } from './types.ts';

export enum MapObject { None, Tree, Stone, Sapling, Field, Wheat }

/** What lies under a mountain point. */
export enum OreKind { None, Stone, Coal, Iron, Gold }
export const ORE_NAMES = ['none', 'stone', 'coal', 'iron', 'gold'] as const;
/** The ore a mine digs; None for everything else. */
export function oreKindOf(type: BuildingType): OreKind {
  switch (type) {
    case BuildingType.StoneMine: return OreKind.Stone;
    case BuildingType.CoalMine: return OreKind.Coal;
    case BuildingType.IronMine: return OreKind.Iron;
    case BuildingType.GoldMine: return OreKind.Gold;
    default: return OreKind.None;
  }
}

/** How far from its building a lumberjack or stonecutter will look, in steps. */
export const HARVEST_RADIUS = 6;
/** A worker with nothing to harvest looks again this often, in ticks. */
export const SCAN_TICKS = 128;
/** How far from its building a forester will plant, in steps. */
export const PLANT_RADIUS = 5;
/** Ticks a sapling takes to grow into a tree. */
export const GROW_TICKS = 6000;
/** How far under the rock a mine digs, in steps from its building. */
export const ORE_RADIUS = 3;
/** Ore units a mountain point holds (the points that have any). */
export const ORE_MIN = 6;
export const ORE_MAX = 14;
/** Share of mountain points with ore (default; clusters). */
export const ORE_SHARE = 0.45;
/** Shares of the ore points that are gold, iron and coal; the rest is stone. */
export const ORE_MIX = { gold: 0.15, iron: 0.3, coal: 0.3 } as const;
/** How far from the flag he was sent to a geologist probes, in steps. */
export const GEO_RADIUS = 5;
/** Spots a geologist probes on one trip before he goes home. */
export const GEO_PROBES = 8;
/** Ticks he taps at one spot with his hammer. */
export const GEO_PROBE_TICKS = 300;
/** Ticks a sign stays up before it fades. */
export const SIGN_TICKS = 9000;
/** A sign shows a small deposit below this many units, a large one at or above. */
export const SIGN_SMALL_BELOW = 12;

/** What a geologist's sign says. 0 none, 1 nothing found, 2 and up: an ore kind, large (even) or small (odd). */
export const SIGN_EMPTY = 1;
export const signFor = (kind: OreKind, units: number): number => 2 + (kind - 1) * 2 + (units < SIGN_SMALL_BELOW ? 1 : 0);
export const signKind = (sign: number): OreKind => (sign >= 2 ? (((sign - 2) >> 1) + 1) as OreKind : OreKind.None);
export const signIsSmall = (sign: number): boolean => sign >= 2 && ((sign - 2) & 1) === 1;

/** How far from its farm a farmer works the fields, in steps. */
export const FIELD_RADIUS = 4;
/** Most fields (growing or ripe) within reach of a farm. */
export const MAX_FIELDS = 6;
/** Ticks a sown field takes to ripen. */
export const FIELD_TICKS = 3000;
export const STONE_UNITS_MIN = 4;
export const STONE_UNITS_MAX = 8;

export class MapObjects {
  readonly cols: number;
  readonly rows: number;
  readonly kind: Uint8Array;
  /** Units left in a rock; 1 for a tree. */
  readonly amount: Uint8Array;
  /** Building index + 1 of the worker that has claimed the object, 0 = free. */
  readonly reservedBy: Int32Array;
  /** Ticks left until a sapling is a tree, or a field is ripe. */
  readonly growth: Uint16Array;
  /** Ore left under each mountain point; mines dig it and it never comes back. */
  readonly ore: Uint8Array;
  /** Which OreKind each point's ore is. */
  readonly oreKind: Uint8Array;
  private growing: number[] = [];
  /** What the geologists found, by point (see `signFor`); it fades after `signLeft` ticks. Signs never block anything. */
  readonly sign: Uint8Array;
  readonly signLeft: Uint16Array;
  private signed: number[] = [];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.kind = new Uint8Array(cols * rows);
    this.amount = new Uint8Array(cols * rows);
    this.reservedBy = new Int32Array(cols * rows);
    this.growth = new Uint16Array(cols * rows);
    this.ore = new Uint8Array(cols * rows);
    this.oreKind = new Uint8Array(cols * rows);
    this.sign = new Uint8Array(cols * rows);
    this.signLeft = new Uint16Array(cols * rows);
  }

  /** Put up a sign for `ticks`. */
  setSign(pos: number, sign: number, ticks = SIGN_TICKS): void {
    if (this.sign[pos] === 0) this.signed.push(pos);
    this.sign[pos] = sign;
    this.signLeft[pos] = ticks;
  }

  /** Signs age by `delta` ticks; those whose time is up come down. */
  fadeSigns(delta: number): void {
    if (this.signed.length === 0) return;
    const still: number[] = [];
    for (const p of this.signed) {
      const left = this.signLeft[p]! - delta;
      if (left <= 0) {
        this.sign[p] = 0;
        this.signLeft[p] = 0;
      } else {
        this.signLeft[p] = left;
        still.push(p);
      }
    }
    this.signed = still;
  }

  /** After loading: find the signs again (the list is not saved). */
  rebuildSigns(): void {
    this.signed = [];
    for (let p = 0; p < this.sign.length; p++) if (this.sign[p] !== 0) this.signed.push(p);
  }

  setOre(pos: number, amount: number, kind: OreKind = OreKind.Stone): void {
    this.ore[pos] = amount;
    this.oreKind[pos] = amount > 0 ? kind : OreKind.None;
  }

  /** After loading: find the saplings again (the list is not saved). */
  rebuildGrowing(): void {
    this.growing = [];
    for (let p = 0; p < this.kind.length; p++) if (this.kind[p] === MapObject.Sapling || this.kind[p] === MapObject.Field) this.growing.push(p);
  }

  /** A sapling that becomes a tree after `ticks`. */
  plant(pos: number, ticks = GROW_TICKS, kind: MapObject.Sapling | MapObject.Field = MapObject.Sapling): void {
    this.set(pos, kind);
    this.growth[pos] = ticks;
    this.growing.push(pos);
  }

  /** Saplings age by `delta` ticks; those that are ready become trees. */
  grow(delta: number): void {
    if (this.growing.length === 0) return;
    const still: number[] = [];
    for (const p of this.growing) {
      const k = this.kind[p];
      if (k !== MapObject.Sapling && k !== MapObject.Field) continue; // cleared meanwhile
      const left = this.growth[p]! - delta;
      if (left <= 0) {
        this.growth[p] = 0;
        this.kind[p] = k === MapObject.Sapling ? MapObject.Tree : MapObject.Wheat;
      } else {
        this.growth[p] = left;
        still.push(p);
      }
    }
    this.growing = still;
  }

  kindAt(pos: number): MapObject {
    return this.kind[pos]! as MapObject;
  }

  amountAt(pos: number): number {
    return this.amount[pos]!;
  }

  set(pos: number, kind: MapObject, amount = 1): void {
    this.kind[pos] = kind;
    this.amount[pos] = kind === MapObject.None ? 0 : amount;
    this.reservedBy[pos] = 0;
  }

  remove(pos: number): void {
    this.set(pos, MapObject.None);
  }

  /** Units of `kind` ore under the points within `radius` steps of `pos`. */
  oreNear(pos: number, kind: OreKind, radius = ORE_RADIUS): number {
    let n = 0;
    this.eachNear(pos, radius, (p) => {
      if (this.oreKind[p] === kind) n += this.ore[p]!;
    });
    return n;
  }

  /** The nearest point within `radius` steps of `pos` that still has `kind` ore; ties go to the lower point. -1 if none. */
  nearestOre(pos: number, kind: OreKind, radius = ORE_RADIUS): number {
    let best = -1;
    let bestDist = Infinity;
    this.eachNear(pos, radius, (p, d) => {
      if (this.ore[p]! > 0 && this.oreKind[p] === kind && (d < bestDist || (d === bestDist && p < best))) {
        best = p;
        bestDist = d;
      }
    });
    return best;
  }

  private eachNear(pos: number, radius: number, fn: (p: number, d: number) => void): void {
    const x0 = pos % this.cols;
    const y0 = Math.floor(pos / this.cols);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d = hexDistance(dx, dy);
        if (d > radius) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) continue;
        fn(y * this.cols + x, d);
      }
    }
  }

  count(kind: MapObject): number {
    let n = 0;
    for (const k of this.kind) if (k === kind) n++;
    return n;
  }
}

export interface ObjectOptions {
  /** Points to leave empty (a start area, say). */
  keepClear?: (pos: number) => boolean;
  /** Share of free grass covered by trees (default 0.18). */
  trees?: number;
  /** Share of free grass covered by rocks (default 0.03). */
  stones?: number;
  /** Share of mountain points holding ore (default ORE_SHARE). */
  ore?: number;
}

/**
 * Forests and rock fields on grass. Points are ranked by smooth noise, so the
 * share of trees and rocks is the same on every seed and they come in clusters.
 * Same inputs, same objects.
 */
export function generateObjects(terrain: TerrainMap, seed: number, opts: ObjectOptions = {}): MapObjects {
  const { cols, rows } = terrain;
  const objects = new MapObjects(cols, rows);
  const treeShare = opts.trees ?? 0.18;
  const stoneShare = opts.stones ?? 0.03;
  const keepClear = opts.keepClear ?? (() => false);

  const free: number[] = [];
  for (let p = 0; p < cols * rows; p++) {
    if (terrain.kindAt(p) === Terrain.Grass && !keepClear(p)) free.push(p);
  }
  const noiseAt = (p: number, scale: number, salt: number): number => {
    const x = p % cols;
    const y = Math.floor(p / cols);
    return valueNoise((x - y / 2) / scale, (y * 0.866) / scale, seed + salt);
  };
  const byNoise = (points: number[], scale: number, salt: number): number[] => {
    const n = new Map<number, number>(points.map((p) => [p, noiseAt(p, scale, salt)]));
    return points.slice().sort((a, b) => n.get(b)! - n.get(a)! || a - b); // highest first
  };

  // Trees: the densest noise clusters, thinned a little so forests are not solid.
  const thin = 0.75;
  const treeRank = byNoise(free, 7, 101);
  const wantTrees = Math.round((free.length * treeShare) / thin);
  for (let i = 0; i < wantTrees && i < treeRank.length; i++) {
    const p = treeRank[i]!;
    if (hash01(p, 0, seed + 5) < thin) objects.set(p, MapObject.Tree);
  }

  // Rocks: their own clusters, on ground the trees left.
  const open = free.filter((p) => objects.kindAt(p) === MapObject.None);
  const rockRank = byNoise(open, 5, 202);
  const spread = 0.5;
  const wantRocks = Math.round((free.length * stoneShare) / spread);
  for (let i = 0; i < wantRocks && i < rockRank.length; i++) {
    const p = rockRank[i]!;
    if (hash01(p, 1, seed + 6) < spread) {
      const units = STONE_UNITS_MIN + Math.floor(hash01(p, 2, seed + 7) * (STONE_UNITS_MAX - STONE_UNITS_MIN + 1));
      objects.set(p, MapObject.Stone, units);
    }
  }

  // Ore: in clusters under the mountains, the richest noise first.
  const mountain: number[] = [];
  for (let p = 0; p < cols * rows; p++) if (terrain.kindAt(p) === Terrain.Mountain) mountain.push(p);
  const oreRank = byNoise(mountain, 4, 303);
  const wantOre = Math.round(mountain.length * (opts.ore ?? ORE_SHARE));
  const chosen = oreRank.slice(0, wantOre);
  for (const p of chosen) objects.ore[p] = ORE_MIN + Math.floor(hash01(p, 3, seed + 8) * (ORE_MAX - ORE_MIN + 1));
  // The kinds lie in regions: rank the ore points by a second, broader noise and cut it into bands.
  const kindRank = byNoise(chosen, 9, 404);
  const bands: [OreKind, number][] = [[OreKind.Gold, ORE_MIX.gold], [OreKind.Iron, ORE_MIX.iron], [OreKind.Coal, ORE_MIX.coal], [OreKind.Stone, 1]];
  let from = 0;
  let upTo = 0;
  for (const [kind, share] of bands) {
    upTo = kind === OreKind.Stone ? kindRank.length : Math.min(kindRank.length, upTo + Math.round(kindRank.length * share));
    for (let i = from; i < upTo; i++) objects.oreKind[kindRank[i]!] = kind;
    from = upTo;
  }
  return objects;
}

/** Steps between two map points (see hexDistance). */
export function distanceBetween(cols: number, a: number, b: number): number {
  return hexDistance((b % cols) - (a % cols), Math.floor(b / cols) - Math.floor(a / cols));
}
