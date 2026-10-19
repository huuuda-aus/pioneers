// Foresters plant saplings, saplings grow into trees, lumberjacks fell trees:
// wood becomes renewable. Maps are small and hand-built so timings are exact.
import { describe, expect, it } from 'vitest';
import {
  BState,
  BuildingType,
  Dir,
  GROW_TICKS,
  Game,
  MapObject,
  MapObjects,
  PLANT_RADIUS,
  Res,
  SCAN_TICKS,
  STEP_TICKS,
  TerrainMap,
  checkBuilding,
  distanceBetween,
  planRoad,
} from '../src/index.ts';
import * as sc from './scenarios.ts';

const at = (g: Game, x: number, y: number) => g.index(x, y);
const world = (cols = 24, rows = 16): Game => new Game(cols, rows, undefined, new MapObjects(cols, rows));
const objs = (g: Game): MapObjects => g.objects!;
const forester = (g: Game, x: number, y: number): number => g.placeBuilding(BuildingType.Forester, at(g, x, y), false);

function all(g: Game, kind: MapObject): number[] {
  const out: number[] = [];
  for (let p = 0; p < g.cols * g.rows; p++) if (objs(g).kindAt(p) === kind) out.push(p);
  return out;
}

describe('saplings', () => {
  it('grow into trees after exactly their time', () => {
    const g = world();
    objs(g).plant(at(g, 5, 5), 100);
    expect(objs(g).kindAt(at(g, 5, 5))).toBe(MapObject.Sapling);
    sc.run(g, 49); // 98 ticks at speed 2
    expect(objs(g).kindAt(at(g, 5, 5))).toBe(MapObject.Sapling);
    sc.run(g, 1);
    expect(objs(g).kindAt(at(g, 5, 5))).toBe(MapObject.Tree);
  });

  it('are not trees to a lumberjack, but block building like one', () => {
    const g = world();
    g.placeBuilding(BuildingType.Lumberjack, at(g, 5, 5), false);
    objs(g).plant(at(g, 6, 5));
    sc.run(g, 5);
    expect(g.buildings[0]!.state).toBe(BState.NoResource);
    objs(g).plant(at(g, 12, 5));
    const c = checkBuilding(g, BuildingType.Lumberjack, at(g, 12, 5));
    expect(c.ok).toBe(false);
    expect(c.reason).toMatch(/young tree/);
  });

  it('are not harvested by the lumberjack until grown', () => {
    const g = world();
    g.placeBuilding(BuildingType.Lumberjack, at(g, 5, 5), false);
    objs(g).plant(at(g, 7, 5), 1000);
    sc.run(g, 400);
    expect(objs(g).kindAt(at(g, 7, 5))).toBe(MapObject.Sapling);
    expect(g.buildings[0]!.state).toBe(BState.NoResource);
    sc.run(g, 400); // now a tree: it is felled
    expect(g.buildings[0]!.state).not.toBe(BState.NoResource);
    sc.run(g, 1500);
    expect(objs(g).kindAt(at(g, 7, 5))).toBe(MapObject.None);
  });
});

describe('the forester', () => {
  it('walks out, plants one sapling after exactly its trip, and goes on', () => {
    const g = world();
    const fi = forester(g, 10, 6);
    const b = g.buildings[fi]!;
    let steps = 0;
    while (all(g, MapObject.Sapling).length === 0 && steps < 2000) {
      g.update();
      steps++;
    }
    const [p] = all(g, MapObject.Sapling);
    expect(p).toBeDefined();
    const d = distanceBetween(g.cols, b.pos, p!);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(PLANT_RADIUS);
    // trip: out, work, back; the first step only starts it
    const trip = 2 * d * STEP_TICKS + b.period;
    expect(steps * g.speed).toBeGreaterThanOrEqual(trip);
    expect(steps * g.speed).toBeLessThanOrEqual(trip + 3 * g.speed);
    expect(b.target).toBe(-1);
    sc.run(g, 3000);
    expect(all(g, MapObject.Sapling).length + all(g, MapObject.Tree).length).toBeGreaterThan(2);
  });

  it('only plants on free grass in reach: never on a road, flag or building, nor in the wild', () => {
    const g = world();
    const fi = forester(g, 10, 6);
    const door = g.buildings[fi]!.flag;
    g.addFlag(15, 7);
    g.addRoad(door, new Array<Dir>(4).fill(Dir.Right));
    sc.run(g, 40000);
    const grown = [...all(g, MapObject.Sapling), ...all(g, MapObject.Tree)];
    expect(grown.length).toBeGreaterThan(10);
    for (const p of grown) {
      expect(g.isOccupied(p), `point ${p}`).toBe(false);
      expect(distanceBetween(g.cols, g.buildings[fi]!.pos, p)).toBeLessThanOrEqual(PLANT_RADIUS);
    }
  });

  it('stops when there is no room, and starts again when room appears', () => {
    const g = world(14, 10);
    const o = objs(g);
    const fi = forester(g, 6, 4);
    // fill the whole reach with rocks except the forester's own point and flag
    for (let p = 0; p < g.cols * g.rows; p++) if (!g.isOccupied(p)) o.set(p, MapObject.Stone, 3);
    sc.run(g, 5);
    expect(g.buildings[fi]!.state).toBe(BState.NoResource);
    o.remove(at(g, 8, 5));
    sc.run(g, Math.ceil(SCAN_TICKS / g.speed) + 2);
    expect(g.buildings[fi]!.state).toBe(BState.Working);
    expect(g.buildings[fi]!.target).toBe(at(g, 8, 5));
  });

  it('does not plant where a flag was placed while it walked', () => {
    const g = world();
    const fi = forester(g, 10, 6);
    sc.run(g, 3);
    const target = g.buildings[fi]!.target;
    expect(target).toBeGreaterThanOrEqual(0);
    const x = target % g.cols;
    const y = Math.floor(target / g.cols);
    if (!g.isOccupied(target)) {
      try { g.addFlag(x, y); } catch { return; /* too close to another flag: nothing to test */ }
    }
    sc.run(g, 2000);
    expect(objs(g).kindAt(target)).toBe(MapObject.None);
    expect(g.flagAtPos(target)).toBeGreaterThanOrEqual(0);
  });

  it('two foresters never claim the same spot', () => {
    const g = world();
    forester(g, 9, 6);
    forester(g, 11, 6);
    for (let i = 0; i < 4000; i++) {
      g.update();
      const claims = g.buildings.map((b) => b.target).filter((t) => t >= 0);
      expect(new Set(claims).size).toBe(claims.length);
    }
  });

  it('releases its claim when demolished', () => {
    const g = world();
    const fi = forester(g, 10, 6);
    g.addBuilding(BuildingType.Castle, g.addFlag(2, 2));
    sc.run(g, 3);
    const target = g.buildings[fi]!.target;
    expect(objs(g).reservedBy[target]).toBe(fi + 1);
    g.demolishBuilding(fi);
    expect(objs(g).reservedBy[target]).toBe(0);
  });

  it('does nothing on a map without objects, and makes nothing', () => {
    const g = new Game(20, 12);
    const fi = g.placeBuilding(BuildingType.Forester, at(g, 10, 6), false);
    sc.run(g, 2000);
    expect(g.buildings[fi]!.state).toBe(BState.Idle);
    expect(g.created.every((n) => n === 0)).toBe(true);
  });

  it('is built from planks like any site', () => {
    const g = new Game(30, 16);
    const castle = g.placeBuilding(BuildingType.Castle, at(g, 4, 4), false);
    g.addStock(castle, Res.Plank, 5);
    const fi = g.placeBuilding(BuildingType.Forester, at(g, 12, 5), true);
    g.addRoad(g.flagAtPos(at(g, 5, 5)), planRoad(g, g.flagAtPos(at(g, 5, 5)), at(g, 13, 6))!);
    sc.run(g, 2500);
    expect(g.buildings[fi]!.constructing).toBe(false);
    expect(g.buildings[castle]!.stock[Res.Plank]).toBe(3);
  });

  it('is deterministic', () => {
    const run = () => {
      const g = world();
      forester(g, 10, 6);
      sc.run(g, 8000);
      return [g.fingerprint(), [...objs(g).kind].join(''), [...objs(g).growth].join(',')];
    };
    expect(run()).toEqual(run());
  });
});

describe('a renewable forest', () => {
  function colony(withForester: boolean) {
    const g = new Game(30, 16, TerrainMap.flat(30, 16), new MapObjects(30, 16));
    const castle = g.placeBuilding(BuildingType.Castle, at(g, 4, 6), false);
    const jack = g.placeBuilding(BuildingType.Lumberjack, at(g, 11, 6), false);
    g.addRoad(g.flagAtPos(at(g, 5, 7)), new Array<Dir>(7).fill(Dir.Right));
    if (withForester) {
      g.placeBuilding(BuildingType.Forester, at(g, 11, 9), false);
      g.addRoad(g.flagAtPos(at(g, 12, 10)), [Dir.Up, Dir.Up, Dir.Up]);
    }
    return { g, castle, jack };
  }

  it('without a forester an empty land gives no wood; with one it does, for good', () => {
    const none = colony(false);
    sc.run(none.g, 40000);
    expect(none.g.buildings[none.castle]!.stock[Res.Lumber]).toBe(0);

    const some = colony(true);
    sc.run(some.g, 40000);
    const first = some.g.buildings[some.castle]!.stock[Res.Lumber]!;
    expect(first).toBeGreaterThan(5);
    sc.run(some.g, 40000);
    expect(some.g.buildings[some.castle]!.stock[Res.Lumber]).toBeGreaterThan(first + 5); // still producing
    expect(GROW_TICKS).toBeGreaterThan(0);
  });
});
