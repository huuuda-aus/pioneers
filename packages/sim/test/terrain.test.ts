// Terrain generation and every placement rule. Maps are built by hand so each
// rule is exercised on its own.
import { describe, expect, it } from 'vitest';
import {
  BuildingType,
  Dir,
  FLAT_HEIGHT,
  Game,
  MAX_HEIGHT,
  MAX_ROAD_SLOPE,
  MAX_SLOPE,
  BuildingSize,
  SEA_LEVEL,
  Terrain,
  TerrainMap,
  checkBuilding,
  checkFlagAt,
  flattenArea,
  generateTerrain,
  hexDistance,
  planRoad,
} from '../src/index.ts';

/** A level 12x10 grass map unless told otherwise. */
function flatGame(cols = 12, rows = 10): Game {
  return new Game(cols, rows);
}
const at = (g: Game, x: number, y: number) => g.index(x, y);
const raise = (g: Game, x: number, y: number, h: number) => g.terrain.setHeight(at(g, x, y), h);

describe('terrain generation', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = generateTerrain({ cols: 40, rows: 30, seed: 5 });
    const b = generateTerrain({ cols: 40, rows: 30, seed: 5 });
    const c = generateTerrain({ cols: 40, rows: 30, seed: 6 });
    expect(Array.from(a.height)).toEqual(Array.from(b.height));
    expect(Array.from(a.height)).not.toEqual(Array.from(c.height));
  });

  it('gives every seed the requested mix of water, grass and mountain', () => {
    for (const seed of [1, 2, 3, 42]) {
      const t = generateTerrain({ cols: 48, rows: 40, seed, water: 0.12, mountain: 0.18 });
      const n = [0, 0, 0];
      for (let p = 0; p < 48 * 40; p++) n[t.kindAt(p)]!++;
      const share = (k: Terrain) => n[k]! / (48 * 40);
      expect(share(Terrain.Water)).toBeCloseTo(0.12, 1);
      expect(share(Terrain.Mountain)).toBeCloseTo(0.18, 1);
      expect(share(Terrain.Grass)).toBeCloseTo(0.7, 1);
    }
  });

  it('keeps heights in range and water flat', () => {
    const t = generateTerrain({ cols: 48, rows: 40, seed: 9 });
    for (const h of t.height) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(MAX_HEIGHT);
    }
    for (let p = 0; p < t.height.length; p++) {
      if (t.kindAt(p) === Terrain.Water) expect(t.heightAt(p)).toBe(SEA_LEVEL);
    }
  });

  it('offers plenty of room to build on a generated map', () => {
    const t = generateTerrain({ cols: 48, rows: 40, seed: 1 });
    const g = new Game(48, 40, t);
    let small = 0;
    let large = 0;
    for (let p = 0; p < 48 * 40; p++) {
      if (checkBuilding(g, BuildingType.Lumberjack, p).ok) small++;
      if (checkBuilding(g, BuildingType.Sawmill, p).ok) large++;
    }
    expect(small / (48 * 40)).toBeGreaterThan(0.3);
    expect(large).toBeGreaterThan(0);
    expect(large).toBeLessThanOrEqual(small);
  });

  it('flattens the start area and eases into the surroundings', () => {
    const t = generateTerrain({ cols: 40, rows: 30, seed: 3 });
    const before = Array.from(t.height);
    flattenArea(t, 20, 15, 3, FLAT_HEIGHT, 4);
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 40; x++) {
        const d = hexDistance(x - 20, y - 15);
        const p = y * 40 + x;
        if (d <= 3) expect(t.heightAt(p)).toBe(FLAT_HEIGHT);
        else if (d > 7) expect(t.heightAt(p)).toBe(before[p]);
      }
    }
    // no cliff at the edge of the flat area
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 40; x++) {
        if (hexDistance(x - 20, y - 15) !== 4) continue;
        expect(Math.abs(t.heightAt(y * 40 + x) - FLAT_HEIGHT)).toBeLessThanOrEqual(MAX_SLOPE[BuildingSize.Small] + 3);
      }
    }
  });

  it('measures distance in steps on the skewed grid', () => {
    expect(hexDistance(1, 1)).toBe(1); // DownRight is a neighbour
    expect(hexDistance(1, -1)).toBe(2); // but this diagonal is not
    expect(hexDistance(0, 3)).toBe(3);
    expect(hexDistance(-2, -2)).toBe(2);
  });
});

describe('building placement', () => {
  it('puts a small building at the point and its flag down-right', () => {
    const g = flatGame();
    const v = g.layoutVersion;
    const b = g.placeBuilding(BuildingType.Lumberjack, at(g, 5, 5));
    const bld = g.buildings[b]!;
    expect(bld.pos).toBe(at(g, 5, 5));
    expect(g.flags[bld.flag]!.pos).toBe(at(g, 6, 6));
    expect(g.buildingAtPos(at(g, 5, 5))).toBe(b);
    expect(g.buildingAtPos(at(g, 4, 5))).toBe(-1); // small covers one point
    expect(bld.constructing).toBe(true);
    expect(g.layoutVersion).toBeGreaterThan(v);
  });

  it('covers four points for a large building', () => {
    const g = flatGame();
    const b = g.placeBuilding(BuildingType.Sawmill, at(g, 5, 5));
    for (const [x, y] of [[5, 5], [4, 5], [4, 4], [5, 4]]) expect(g.buildingAtPos(at(g, x!, y!))).toBe(b);
    expect(g.buildingAtPos(at(g, 6, 5))).toBe(-1);
  });

  it('checking never changes the game', () => {
    const g = flatGame();
    const flags = g.flags.length;
    const v = g.layoutVersion;
    expect(checkBuilding(g, BuildingType.Lumberjack, at(g, 5, 5)).ok).toBe(true);
    expect(g.flags.length).toBe(flags);
    expect(g.layoutVersion).toBe(v);
  });

  it('refuses overlap with flags, roads and other buildings', () => {
    const g = flatGame();
    g.placeBuilding(BuildingType.Lumberjack, at(g, 5, 5));
    expect(checkBuilding(g, BuildingType.Lumberjack, at(g, 5, 5)).reason).toBe('something is in the way');
    // a large building whose footprint reaches (5,5)
    expect(checkBuilding(g, BuildingType.Sawmill, at(g, 6, 5)).ok).toBe(false);

    const f1 = g.addFlag(1, 1);
    g.addFlag(5, 1);
    g.addRoad(f1, [Dir.Right, Dir.Right, Dir.Right, Dir.Right]);
    expect(checkBuilding(g, BuildingType.Lumberjack, at(g, 3, 1)).reason).toBe('something is in the way');
  });

  it('refuses spots too close to the edge', () => {
    const g = flatGame();
    expect(checkBuilding(g, BuildingType.Sawmill, at(g, 0, 5)).reason).toBe('too close to the map edge');
    expect(checkBuilding(g, BuildingType.Lumberjack, at(g, 11, 9)).ok).toBe(false); // no room for the flag
    expect(checkBuilding(g, BuildingType.Lumberjack, -1).ok).toBe(false);
  });

  it('says water, not flag, when standing in the sea', () => {
    const g = flatGame();
    for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++) raise(g, x, y, SEA_LEVEL);
    expect(checkBuilding(g, BuildingType.Lumberjack, at(g, 5, 5)).reason).toBe('too close to water');
  });

  it('refuses water and mountains nearby', () => {
    const g = flatGame();
    raise(g, 5, 6, SEA_LEVEL);
    expect(checkBuilding(g, BuildingType.Lumberjack, at(g, 5, 5)).reason).toBe('too close to water');
    const h = flatGame();
    raise(h, 4, 4, 16);
    expect(checkBuilding(h, BuildingType.Lumberjack, at(h, 5, 5)).reason).toBe('not on a mountain');
  });

  it('limits slope by size', () => {
    const g = flatGame();
    const p = at(g, 5, 5);
    raise(g, 6, 5, FLAT_HEIGHT + 3);
    expect(checkBuilding(g, BuildingType.Lumberjack, p).ok).toBe(true); // small allows 3
    expect(checkBuilding(g, BuildingType.Sawmill, p).reason).toBe('ground too steep'); // large allows 2
    raise(g, 6, 5, FLAT_HEIGHT + 4);
    expect(checkBuilding(g, BuildingType.Lumberjack, p).reason).toBe('ground too steep');
    raise(g, 6, 5, FLAT_HEIGHT + 2);
    expect(checkBuilding(g, BuildingType.Sawmill, p).ok).toBe(true);
  });

  it('reuses a free flag at the door and refuses one that has a building', () => {
    const g = flatGame();
    const f = g.addFlag(6, 6);
    const b = g.placeBuilding(BuildingType.Lumberjack, at(g, 5, 5));
    expect(g.buildings[b]!.flag).toBe(f);
    expect(g.flags.length).toBe(1);
    expect(checkBuilding(g, BuildingType.Lumberjack, at(g, 5, 5)).ok).toBe(false);
    // the door flag is taken, so nothing else can claim it
    const g2 = flatGame();
    g2.placeBuilding(BuildingType.Lumberjack, at(g2, 5, 5));
    expect(checkBuilding(g2, BuildingType.Lumberjack, at(g2, 5, 5)).ok).toBe(false);
  });

  it('refuses a door flag that would crowd another flag or sit on water', () => {
    const g = flatGame();
    g.addFlag(7, 6); // next to the door spot (6,6)
    const r = checkBuilding(g, BuildingType.Lumberjack, at(g, 5, 5));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('too close to another flag');
  });

  it('keeps castle rules without leaving a stray flag', () => {
    const g = flatGame();
    expect(() => g.placeBuilding(BuildingType.Castle, at(g, 5, 5), true)).toThrow('cannot be built');
    expect(g.flags.length).toBe(0);
    g.placeBuilding(BuildingType.Castle, at(g, 5, 5), false);
    expect(g.castle).toBeGreaterThanOrEqual(0);
    const flags = g.flags.length;
    expect(() => g.placeBuilding(BuildingType.Castle, at(g, 9, 3), false)).toThrow('only one castle');
    expect(g.flags.length).toBe(flags);
  });
});

describe('flag placement', () => {
  it('needs a free point, space from other flags and dry land', () => {
    const g = flatGame();
    g.addFlag(3, 3);
    expect(checkFlagAt(g, 4, 3).reason).toBe('too close to another flag');
    expect(checkFlagAt(g, 4, 4).reason).toBe('too close to another flag'); // DownRight neighbour
    expect(checkFlagAt(g, 3, 3).reason).toBe('position occupied');
    expect(checkFlagAt(g, 5, 3).ok).toBe(true);
    raise(g, 8, 8, SEA_LEVEL);
    expect(checkFlagAt(g, 8, 8).reason).toBe('cannot place a flag on water');
    expect(() => g.addFlag(8, 8)).toThrow('water');
    expect(checkFlagAt(g, -1, 0).ok).toBe(false);
  });

  it('allows flags on mountains (mines will need them)', () => {
    const g = flatGame();
    raise(g, 8, 8, 18);
    expect(checkFlagAt(g, 8, 8).ok).toBe(true);
  });
});

describe('roads on terrain', () => {
  const R = Dir.Right;

  it('cannot cross water, steep ground or buildings', () => {
    const g = flatGame();
    const a = g.addFlag(1, 1);
    g.addFlag(5, 1);
    raise(g, 3, 1, SEA_LEVEL);
    expect(() => g.addRoad(a, [R, R, R, R])).toThrow('roads cannot cross water');
    raise(g, 3, 1, FLAT_HEIGHT + MAX_ROAD_SLOPE + 1);
    expect(() => g.addRoad(a, [R, R, R, R])).toThrow('too steep for a road');
    raise(g, 3, 1, FLAT_HEIGHT + MAX_ROAD_SLOPE); // exactly at the limit
    expect(() => g.addRoad(a, [R, R, R, R])).not.toThrow();

    const h = flatGame();
    const ha = h.addFlag(1, 1);
    h.addFlag(5, 1);
    h.placeBuilding(BuildingType.Lumberjack, at(h, 3, 1)); // flag lands at (4,2)
    expect(() => h.addRoad(ha, [R, R, R, R])).toThrow('a building is in the way');
  });

  it('plans around a lake and finds nothing across a sea', () => {
    const g = flatGame(10, 8);
    const a = g.addFlag(1, 3);
    const b = g.addFlag(7, 3);
    for (let y = 0; y < 7; y++) raise(g, 4, y, SEA_LEVEL); // a wall of water with a gap at y=7
    const path = planRoad(g, a, g.flags[b]!.pos);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(6); // had to detour
    let pos = g.flags[a]!.pos;
    for (const d of path!) {
      pos = g.move(pos, d);
      if (pos !== g.flags[b]!.pos) expect(g.terrain.kindAt(pos)).not.toBe(Terrain.Water);
    }
    expect(() => g.addRoad(a, path!)).not.toThrow();

    const sea = flatGame(10, 8);
    const sa = sea.addFlag(1, 3);
    const sb = sea.addFlag(7, 3);
    for (let y = 0; y < 8; y++) raise(sea, 4, y, SEA_LEVEL);
    expect(planRoad(sea, sa, sea.flags[sb]!.pos)).toBeNull();
  });

  it('does not plan over steep ridges', () => {
    const g = flatGame(10, 6);
    const a = g.addFlag(1, 2);
    const b = g.addFlag(7, 2);
    for (let y = 0; y < 6; y++) raise(g, 4, y, FLAT_HEIGHT + MAX_ROAD_SLOPE + 2);
    expect(planRoad(g, a, g.flags[b]!.pos)).toBeNull();
  });
});

describe('terrain and the economy', () => {
  it('rejects a mismatched terrain size', () => {
    expect(() => new Game(10, 10, TerrainMap.flat(8, 8))).toThrow('size');
  });

  it('flat terrain is the default and changes nothing', () => {
    const g = new Game(6, 6);
    expect(g.terrain.kindAt(0)).toBe(Terrain.Grass);
    expect(g.terrain.heightAt(0)).toBe(FLAT_HEIGHT);
  });
});
