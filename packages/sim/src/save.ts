// The saved form of a game: plain JSON, versioned. Everything that can be
// worked out again (which flag stands where, which road covers a point, what a
// building occupies, the list of growing saplings) is left out and rebuilt on
// load, so a save cannot disagree with itself about the layout.

import type { Building, Flag, Geologist, Road, StoreLimits, Transporter } from './types.ts';

export const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  cols: number;
  rows: number;
  tick: number;
  speed: number;
  layoutVersion: number;
  searchId: number;
  hired: number;
  created: number[];
  consumed: number[];
  dispatched: number[];
  lost: number[];
  limits: StoreLimits | null;
  geologists?: Geologist[]; // absent in saves made before geologists
  nextGeologist?: number;
  toolShare?: number[]; // absent in saves made before there were kinds of tool
  tools?: boolean; // absent in saves made before workers needed tools
  foodShare?: number[]; // absent in saves made before the food slider
  settlers?: boolean; // absent in saves made before workers walked in
  flags: Flag[];
  roads: Road[];
  buildings: Building[];
  transporters: Transporter[];
  pendingOut: number[];
  homebound?: number[][]; // absent in saves made before spare carriers went home
  /** Ground heights, base64. */
  heights: string;
  objects: SavedObjects | null;
}

export interface SavedObjects {
  kind: string; // base64
  amount: string; // base64
  /** Non-zero entries as [point, value] pairs. */
  reservedBy: [number, number][];
  growth: [number, number][];
  sign?: [number, number][]; // absent before geologists
  signLeft?: [number, number][];
  oreKind?: string; // base64; absent before there were kinds of ore (all of it was stone)
  ore?: string; // base64; absent in saves made before mines dug ore
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string, length: number): Uint8Array {
  const s = atob(text);
  if (s.length !== length) throw new Error('save: wrong data size');
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function sparse(a: ArrayLike<number>): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== 0) out.push([i, a[i]!]);
  return out;
}

export function unsparse(into: { [i: number]: number; length: number }, pairs: [number, number][]): void {
  for (const [i, v] of pairs) {
    if (!Number.isInteger(i) || i < 0 || i >= into.length) throw new Error('save: index out of range');
    into[i] = v;
  }
}
