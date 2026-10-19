// Trees, rocks and the harvest cycle. Maps are small and hand-built so every
// timing can be asserted exactly.
import { describe, expect, it } from 'vitest';
import {
  BState,
  BuildingType,
  Dir,
  FLAT_HEIGHT,
  Game,
  HARVEST_RADIUS,
  MapObject,
  MapObjects,
  Res,
  SCAN_TICKS,
  STEP_TICKS,
  STONE_UNITS_MAX,
  STONE_UNITS_MIN,
  Terrain,
  TerrainMap,
  checkBuilding,
  checkFlagAt,
  flattenArea,
  generateObjects,
  generateTerrain,
  hexDistance,
  planRoad,
} from '../src/index.ts';

/** A level 20x14 map with an empty object layer. */
function world(cols = 20, rows = 14): Game {
  return new Game(cols, rows, undefined, new MapObjects(cols, rows));
}
const at = (g: Game, x: number, y: number) => g.index(x, y);
const objs = (g: Game): MapObjects => g.objects!;

/** A finished lumberjack at building point (x, y), its flag already placed. */
function jack(g: Game, x: number, y: number, type = BuildingType.Lumberjack): number {
  return g.placeBuilding(type, at(g, x, y), false);
}

function runUntil(g: Game, steps: number, stop: (g: Game) => boolean): number {
  for (let i = 0; i < steps; i++) {
    g.update();
    if (stop(g)) return i + 1;
  }
  return -1;
}

describe('object generation', () => {
  const terrain = (() => {
    const t = generateTerrain({ cols: 48, rows: 40, seed: 1 });
    flattenArea(t, 24, 20, 5, FLAT_HEIGHT, 4);
    return t;
  })();

  it('is deterministic per seed and differs between seeds', () => {
    const a = generateObjects(terrain, 1);
    const b = generateObjects(terrain, 1);
    const c = generateObjects(terrain, 2);
    expect(Array.from(a.kind)).toEqual(Array.from(b.kind));
    expect(Array.from(a.amount)).toEqual(Array.from(b.amount));
    expect(Array.from(a.kind)).not.toEqual(Array.from(c.kind));
  });

  it('puts trees and rocks only on grass, in the requested share', () => {
    const o = generateObjects(terrain, 1, { trees: 0.2, stones: 0.04 });
    let grass = 0;
    for (let p = 0; p < 48 * 40; p++) {
      if (terrain.kindAt(p) === Terrain.Grass) grass++;
      else expect(o.kindAt(p)).toBe(MapObject.None);
    }
    expect(o.count(MapObject.Tree) / grass).toBeGreaterThan(0.15);
    expect(o.count(MapObject.Tree) / grass).toBeLessThan(0.25);
    expect(o.count(MapObject.Stone) / grass).toBeGreaterThan(0.02);
    expect(o.count(MapObject.Stone) / grass).toBeLessThan(0.06);
  });

  it('gives rocks a number of units in range, and trees one', () => {
    const o = generateObjects(terrain, 1);
    for (let p = 0; p < 48 * 40; p++) {
      if (o.kindAt(p) === MapObject.Stone) {
        expect(o.amountAt(p)).toBeGreaterThanOrEqual(STONE_UNITS_MIN);
        expect(o.amountAt(p)).toBeLessThanOrEqual(STONE_UNITS_MAX);
      } else if (o.kindAt(p) === MapObject.Tree) expect(o.amountAt(p)).toBe(1);
    }
  });

  it('leaves the cleared area empty and keeps forests clustered', () => {
    const clear = (p: number) => hexDistance((p % 48) - 24, Math.floor(p / 48) - 20) <= 3;
    const o = generateObjects(terrain, 1, { keepClear: clear });
    for (let p = 0; p < 48 * 40; p++) if (clear(p)) expect(o.kindAt(p)).toBe(MapObject.None);
    let clustered = 0;
    let trees = 0;
    for (let p = 0; p < 48 * 40; p++) {
      if (o.kindAt(p) !== MapObject.Tree) continue;
      trees++;
      let n = 0;
      for (const [dx, dy] of [[1, 0], [1, 1], [0, 1], [-1, 0], [-1, -1], [0, -1]] as const) {
        const x = (p % 48) + dx;
        const y = Math.floor(p / 48) + dy;
        if (x >= 0 && y >= 0 && x < 48 && y < 40 && o.kindAt(y * 48 + x) === MapObject.Tree) n++;
      }
      if (n >= 2) clustered++;
    }
    expect(clustered / trees).toBeGreaterThan(0.7); // forests, not scattered singles
  });

  it('puts both resources within reach of the start', () => {
    const clear = (p: number) => hexDistance((p % 48) - 24, Math.floor(p / 48) - 20) <= 3;
    const o = generateObjects(terrain, 1, { keepClear: clear });
    let trees = 0;
    let rocks = 0;
    for (let p = 0; p < 48 * 40; p++) {
      if (hexDistance((p % 48) - 24, Math.floor(p / 48) - 20) > 10) continue;
      if (o.kindAt(p) === MapObject.Tree) trees++;
      if (o.kindAt(p) === MapObject.Stone) rocks++;
    }
    expect(trees).toBeGreaterThan(10);
    expect(rocks).toBeGreaterThan(2);
  });
});

describe('objects block building', () => {
  it('stop flags, roads and buildings', () => {
    const g = world();
    objs(g).set(at(g, 6, 6), MapObject.Tree);
    objs(g).set(at(g, 9, 3), MapObject.Stone, 5);
    expect(checkFlagAt(g, 6, 6).reason).toBe('a tree is in the way');
    expect(checkFlagAt(g, 9, 3).reason).toBe('a rock is in the way');
    expect(() => g.addFlag(6, 6)).toThrow('tree');

    expect(checkBuilding(g, BuildingType.Lumberjack, at(g, 6, 6)).reason).toBe('a tree is in the way');
    // a large building is stopped by a tree anywhere in its footprint, e.g. up-left
    expect(checkBuilding(g, BuildingType.Sawmill, at(g, 7, 7)).reason).toBe('a tree is in the way');
    // but a tree next to a small building does no harm
    expect(checkBuilding(g, BuildingType.Lumberjack, at(g, 7, 6)).ok).toBe(true);

    const a = g.addFlag(2, 3);
    g.addFlag(8, 3);
    objs(g).set(at(g, 5, 3), MapObject.Tree);
    expect(() => g.addRoad(a, new Array<Dir>(6).fill(Dir.Right))).toThrow('a tree is in the way');
  });

  it('are routed around by the road planner', () => {
    const g = world();
    const a = g.addFlag(2, 3);
    const b = g.addFlag(8, 3);
    for (let y = 1; y <= 5; y++) objs(g).set(at(g, 5, y), MapObject.Tree);
    const path = planRoad(g, a, g.flags[b]!.pos);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(6);
    expect(() => g.addRoad(a, path!)).not.toThrow();
  });

  it('must match the grid', () => {
    expect(() => new Game(10, 10, undefined, new MapObjects(8, 8))).toThrow('size');
  });

  it('do not exist unless a layer is given', () => {
    const g = new Game(8, 8);
    expect(g.objects).toBeNull();
    expect(g.objectAtPos(3)).toBe(MapObject.None);
  });
});

describe('the harvest cycle', () => {
  it('walks out, works, walks back, then delivers one lumber', () => {
    const g = world();
    const b = jack(g, 4, 4); // building point (4,4)
    const tree = at(g, 7, 4); // 3 steps east
    objs(g).set(tree, MapObject.Tree);
    const period = g.buildings[b]!.period;
    const trip = 2 * 3 * STEP_TICKS + period; // out, work, back
    const steps = Math.ceil(trip / g.speed);

    const done = runUntil(g, steps + 10, (gg) => gg.created[Res.Lumber]! === 1);
    expect(done).toBeGreaterThan(0);
    expect(Math.abs(done - steps)).toBeLessThanOrEqual(2); // exactly one trip, no more, no less
    expect(objs(g).kindAt(tree)).toBe(MapObject.None); // the tree is gone
    expect(g.buildings[b]!.target).toBe(-1);
  });

  it('goes for the nearest tree first, and a farther one next', () => {
    const g = world();
    const b = jack(g, 4, 4);
    const near = at(g, 6, 4);
    const far = at(g, 4, 9); // 5 steps south
    objs(g).set(far, MapObject.Tree);
    objs(g).set(near, MapObject.Tree);
    g.update();
    g.update();
    expect(g.buildings[b]!.target).toBe(near);
    expect(objs(g).reservedBy[near]).toBe(b + 1);
    runUntil(g, 2000, () => objs(g).kindAt(near) === MapObject.None);
    runUntil(g, 5, () => g.buildings[b]!.target === far);
    expect(g.buildings[b]!.target).toBe(far);
  });

  it('lets only one worker claim a tree', () => {
    const g = world();
    const a = jack(g, 4, 4);
    const b = jack(g, 4, 7);
    objs(g).set(at(g, 6, 5), MapObject.Tree);
    g.update();
    g.update();
    const working = [a, b].filter((i) => g.buildings[i]!.state === BState.Working);
    const waiting = [a, b].filter((i) => g.buildings[i]!.state === BState.NoResource);
    expect(working.length).toBe(1);
    expect(waiting.length).toBe(1);
  });

  it('ignores trees beyond reach', () => {
    const g = world(24, 14);
    const b = jack(g, 4, 4);
    objs(g).set(at(g, 4 + HARVEST_RADIUS + 1, 4), MapObject.Tree);
    runUntil(g, 400, () => false);
    expect(g.buildings[b]!.state).toBe(BState.NoResource);
    expect(g.created[Res.Lumber]).toBe(0);
    // one step closer is within reach
    objs(g).remove(at(g, 4 + HARVEST_RADIUS + 1, 4));
    objs(g).set(at(g, 4 + HARVEST_RADIUS, 4), MapObject.Tree);
    const started = runUntil(g, Math.ceil(SCAN_TICKS / g.speed) + 5, (gg) => gg.buildings[b]!.state === BState.Working);
    expect(started).toBeGreaterThan(0);
  });

  it('measures reach in steps, not in columns and rows', () => {
    // 6 columns east and 1 row up is 7 steps on this grid: out of reach, even
    // though it lies inside the 13 x 13 square around the building.
    const g = world(24, 14);
    const b = jack(g, 4, 6);
    objs(g).set(at(g, 4 + HARVEST_RADIUS, 6 - 1), MapObject.Tree);
    expect(hexDistance(HARVEST_RADIUS, -1)).toBe(HARVEST_RADIUS + 1);
    runUntil(g, 400, () => false);
    expect(g.buildings[b]!.state).toBe(BState.NoResource);
    // the mirror image, 6 columns east and 1 row down, is exactly 6 steps: in reach
    objs(g).remove(at(g, 4 + HARVEST_RADIUS, 6 - 1));
    objs(g).set(at(g, 4 + HARVEST_RADIUS, 6 + 1), MapObject.Tree);
    expect(hexDistance(HARVEST_RADIUS, 1)).toBe(HARVEST_RADIUS);
    const started = runUntil(g, Math.ceil(SCAN_TICKS / g.speed) + 5, (gg) => gg.buildings[b]!.state === BState.Working);
    expect(started).toBeGreaterThan(0);
  });

  it('waits with nothing in range, rescans, and starts when a tree appears', () => {
    const g = world();
    const b = jack(g, 4, 4);
    runUntil(g, 300, () => false);
    expect(g.buildings[b]!.state).toBe(BState.NoResource);
    expect(g.created[Res.Lumber]).toBe(0);
    objs(g).set(at(g, 6, 4), MapObject.Tree);
    const started = runUntil(g, Math.ceil(SCAN_TICKS / g.speed) + 5, (gg) => gg.buildings[b]!.state === BState.Working);
    expect(started).toBeGreaterThan(0);
  });

  it('fells exactly as many trees as there are, then stops', () => {
    const g = world();
    const b = jack(g, 4, 4);
    for (const [x, y] of [[5, 4], [6, 4], [7, 4], [5, 5]]) objs(g).set(at(g, x!, y!), MapObject.Tree);
    const trees = objs(g).count(MapObject.Tree);
    runUntil(g, 12000, () => false);
    expect(g.created[Res.Lumber]).toBe(trees);
    expect(objs(g).count(MapObject.Tree)).toBe(0);
    expect(g.buildings[b]!.state === BState.NoResource || g.buildings[b]!.state === BState.OutputBlocked).toBe(true);
  });

  it('keeps counts honest: lumber made equals lumber found', () => {
    const g = world();
    jack(g, 4, 4);
    for (const x of [6, 7, 8]) objs(g).set(at(g, x, 4), MapObject.Tree);
    runUntil(g, 6000, () => false);
    expect(g.created[Res.Lumber]! - g.consumed[Res.Lumber]!).toBe(g.countItems(Res.Lumber));
  });
});

describe('stonecutting', () => {
  it('takes one unit per trip and removes the rock when it is used up', () => {
    const g = world();
    const b = jack(g, 4, 4, BuildingType.Stonecutter);
    const rock = at(g, 6, 4);
    objs(g).set(rock, MapObject.Stone, 3);
    // first trip
    const trip = 2 * 2 * STEP_TICKS + g.buildings[b]!.period;
    runUntil(g, Math.ceil(trip / g.speed) + 3, (gg) => gg.created[Res.Stone]! === 1);
    expect(g.created[Res.Stone]).toBe(1);
    expect(objs(g).amountAt(rock)).toBe(2);
    expect(objs(g).reservedBy[rock]).toBe(0); // free again between trips
    runUntil(g, 12000, () => false);
    expect(g.created[Res.Stone]).toBe(3);
    expect(objs(g).kindAt(rock)).toBe(MapObject.None);
  });

  it('does not mistake trees for rocks or the other way round', () => {
    const g = world();
    const cutter = jack(g, 4, 4, BuildingType.Stonecutter);
    objs(g).set(at(g, 6, 4), MapObject.Tree);
    runUntil(g, 300, () => false);
    expect(g.buildings[cutter]!.state).toBe(BState.NoResource);

    const h = world();
    const lj = jack(h, 4, 4);
    objs(h).set(at(h, 6, 4), MapObject.Stone, 4);
    runUntil(h, 300, () => false);
    expect(h.buildings[lj]!.state).toBe(BState.NoResource);
  });
});

describe('resources are unlimited without objects', () => {
  it('a lumberjack on a plain map still produces by its period alone', () => {
    const g = new Game(12, 8);
    const b = g.placeBuilding(BuildingType.Lumberjack, g.index(4, 4), false);
    const steps = Math.ceil((g.buildings[b]!.period + g.speed) / g.speed) + 2;
    runUntil(g, steps, (gg) => gg.created[Res.Lumber]! === 1);
    expect(g.created[Res.Lumber]).toBe(1);
  });

  it('terrain size mismatch still throws with an objects layer', () => {
    expect(() => new Game(10, 10, TerrainMap.flat(8, 8), new MapObjects(10, 10))).toThrow('size');
  });
});
