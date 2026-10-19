// Where things may go. Pure rules over a Game's public state: they never
// mutate it, and every refusal says why so the UI can show it.
//
// All numbers here are placeholders to tune by feel, in the spirit of the
// original (steeper land fits small buildings, big ones need level ground).

import { BuildingType, DIRS, Dir } from './types.ts';
import { Terrain } from './terrain.ts';
import { MapObject, OreKind, oreKindOf } from './objects.ts';
import type { Game } from './game.ts';

export enum BuildingSize { Small, Large }

export function buildingSize(type: BuildingType): BuildingSize {
  switch (type) {
    case BuildingType.Lumberjack:
    case BuildingType.Stonecutter:
    case BuildingType.Forester:
    case BuildingType.Fisher:
    case BuildingType.Well:
    case BuildingType.StoneMine:
    case BuildingType.CoalMine:
    case BuildingType.IronMine:
    case BuildingType.GoldMine:
    case BuildingType.IronSmelter:
    case BuildingType.GoldSmelter:
    case BuildingType.Toolmaker:
    case BuildingType.Butcher:
      return BuildingSize.Small;
    case BuildingType.Sawmill:
    case BuildingType.Storage:
    case BuildingType.Castle: // placeholder: same footprint as other large ones
    case BuildingType.Farm:
    case BuildingType.Mill:
    case BuildingType.Baker:
    case BuildingType.PigFarm:
      return BuildingSize.Large;
  }
}

/** Points a building covers besides its own, relative to its building point. */
export const FOOTPRINT: Record<BuildingSize, Dir[]> = {
  [BuildingSize.Small]: [],
  [BuildingSize.Large]: [Dir.Left, Dir.UpLeft, Dir.Up],
};

/** Largest height difference between a covered point and any neighbour. */
export const MAX_SLOPE: Record<BuildingSize, number> = {
  [BuildingSize.Small]: 3,
  [BuildingSize.Large]: 2,
};

/** A fisher casts for fish in water this many steps away. */
export const FISH_RADIUS = 5;

/** Largest height difference along one road step. */
export const MAX_ROAD_SLOPE = 5;

export interface Check {
  ok: boolean;
  /** Empty when ok. */
  reason: string;
}

const OK: Check = { ok: true, reason: '' };

const objectReason = (o: MapObject): string =>
  o === MapObject.Tree ? 'a tree is in the way'
  : o === MapObject.Sapling ? 'a young tree is in the way'
  : o === MapObject.Field || o === MapObject.Wheat ? 'a field is in the way'
  : 'a rock is in the way';
const no = (reason: string): Check => ({ ok: false, reason });

/** A flag sits at the building point's down-right neighbour. */
export function flagPosFor(game: Game, buildingPos: number): number {
  return game.move(buildingPos, Dir.DownRight);
}

/** Points covered by a building of `type` at `pos`, or null if any is off the map. */
export function footprintOf(game: Game, type: BuildingType, pos: number): number[] | null {
  const pts = [pos];
  for (const d of FOOTPRINT[buildingSize(type)]) {
    const q = game.move(pos, d);
    if (q < 0) return null;
    pts.push(q);
  }
  return pts;
}

export function checkFlag(game: Game, pos: number): Check {
  if (pos < 0) return no('outside the map');
  // A road tile is fine: a flag there splits the road (see Game.addFlag).
  if (game.flagAtPos(pos) >= 0 || game.buildingAtPos(pos) >= 0) {
    return no('position occupied');
  }
  const obj = game.objectAtPos(pos);
  if (obj !== MapObject.None) return no(objectReason(obj));
  for (let d = 0; d < DIRS; d++) {
    const n = game.move(pos, d as Dir);
    if (n >= 0 && game.flagAtPos(n) >= 0) return no('too close to another flag');
  }
  if (game.terrain.kindAt(pos) === Terrain.Water) return no('cannot place a flag on water');
  return OK;
}

/** One road step from `from` to the adjacent point `to`. */
export function checkRoadStep(game: Game, from: number, to: number): Check {
  const t = game.terrain;
  if (t.kindAt(from) === Terrain.Water || t.kindAt(to) === Terrain.Water) {
    return no('roads cannot cross water');
  }
  if (Math.abs(t.heightAt(from) - t.heightAt(to)) > MAX_ROAD_SLOPE) return no('too steep for a road');
  if (game.buildingAtPos(to) >= 0) return no('a building is in the way');
  const obj = game.objectAtPos(to);
  if (obj !== MapObject.None) return no(objectReason(obj));
  return OK;
}

export interface BuildCheck extends Check {
  /** Where the flag goes (may already hold one), -1 if off the map. */
  flagPos: number;
  /** Covered points; empty if they do not all fit on the map. */
  footprint: number[];
}

/** Can a building of `type` stand with its building point at `pos`? */
export function checkBuilding(game: Game, type: BuildingType, pos: number): BuildCheck {
  const flagPos = flagPosFor(game, pos);
  const footprint = pos < 0 ? null : footprintOf(game, type, pos);
  const fail = (reason: string): BuildCheck => ({ ok: false, reason, flagPos, footprint: footprint ?? [] });
  if (pos < 0) return fail('outside the map');
  if (!footprint) return fail('too close to the map edge');
  if (flagPos < 0) return fail('no room for its flag');

  for (const q of footprint) {
    if (game.flagAtPos(q) >= 0 || game.roadAtPos(q) || game.buildingAtPos(q) >= 0) {
      return fail('something is in the way');
    }
    const obj = game.objectAtPos(q);
    if (obj !== MapObject.None) return fail(objectReason(obj));
  }

  const t = game.terrain;
  const oreKind = oreKindOf(type);
  const mine = oreKind !== OreKind.None;
  const fisher = type === BuildingType.Fisher;
  for (const q of footprint) {
    for (const p of [q, ...neighbours(game, q)]) {
      if (p < 0) return fail('too close to the map edge');
      const k = t.kindAt(p);
      if (k === Terrain.Water && !(fisher && p !== q)) return fail('too close to water');
      if (k === Terrain.Mountain && !mine) return fail('not on a mountain');
    }
    if (mine && t.kindAt(q) !== Terrain.Mountain) return fail('mines go on mountains');
  }
  if (fisher && !waterNear(game, pos)) return fail('no water within reach');
  const limit = MAX_SLOPE[buildingSize(type)];
  for (const q of footprint) {
    for (const n of neighbours(game, q)) {
      if (Math.abs(t.heightAt(q) - t.heightAt(n)) > limit) return fail('ground too steep');
    }
  }

  // Terrain first, so open water says "water" rather than complaining about
  // the flag; the door flag is judged last.
  const fi = game.flagAtPos(flagPos);
  if (fi >= 0) {
    if (game.flags[fi]!.building >= 0) return fail('that flag already has a building');
  } else {
    const c = checkFlag(game, flagPos);
    if (!c.ok) return fail(`its flag: ${c.reason}`);
  }
  return { ok: true, reason: '', flagPos, footprint };
}

/** Is there open water within FISH_RADIUS steps of `pos`? */
function waterNear(game: Game, pos: number): boolean {
  const x0 = pos % game.cols;
  const y0 = Math.floor(pos / game.cols);
  for (let dy = -FISH_RADIUS; dy <= FISH_RADIUS; dy++) {
    for (let dx = -FISH_RADIUS; dx <= FISH_RADIUS; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dx - dy)) > FISH_RADIUS) continue;
      const x = x0 + dx;
      const y = y0 + dy;
      if (game.inside(x, y) && game.terrain.kindAt(game.index(x, y)) === Terrain.Water) return true;
    }
  }
  return false;
}

function neighbours(game: Game, pos: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < DIRS; d++) out.push(game.move(pos, d as Dir));
  return out;
}
