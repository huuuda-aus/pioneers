// Saving: a restored game must carry on exactly like the one it came from, in
// every kind of state the sim can be in (carriers mid-walk, builders on their
// way, a harvester out at a tree, a building on fire, saplings growing...).
import { describe, expect, it } from 'vitest';
import {
  BuildingType,
  DEFAULT_LIMITS,
  Game,
  MapObject,
  MapObjects,
  Res,
  SAVE_VERSION,
  TerrainMap,
  generateObjects,
  generateTerrain,
  planRoad,
  FLAT_HEIGHT,
} from '../src/index.ts';
import * as sc from './scenarios.ts';

const T = BuildingType;

/** Through real JSON, as a browser would store it. */
const roundtrip = (g: Game): Game => Game.restore(JSON.parse(JSON.stringify(g.serialize())));
const state = (g: Game): string => JSON.stringify(g.serialize());

/** A road along whatever route the planner finds between the flags at the two points. */
function link(g: Game, x1: number, y1: number, x2: number, y2: number): void {
  const from = g.flagAtPos(g.index(x1, y1));
  g.addRoad(from, planRoad(g, from, g.index(x2, y2))!);
}

/** Everything the layout lookups answer, for every point. */
function lookups(g: Game): string {
  const out: number[] = [];
  for (let p = 0; p < g.cols * g.rows; p++) out.push(g.flagAtPos(p), g.roadIndexAt(p), g.buildingAtPos(p));
  return out.join(',');
}

/** Save at this moment, then run both versions on and compare them all along. */
function carriesOn(g: Game, steps = 4000, commands?: (g: Game) => void): Game {
  const copy = roundtrip(g);
  expect(state(copy)).toBe(state(g));
  expect(lookups(copy)).toBe(lookups(g));
  expect(copy.fingerprint()).toBe(g.fingerprint());
  commands?.(g);
  commands?.(copy);
  for (let i = 0; i < steps; i++) {
    g.update();
    copy.update();
    if (i % 250 === 0) expect(copy.fingerprint(), `step ${i}`).toBe(g.fingerprint());
  }
  expect(state(copy)).toBe(state(g));
  expect(lookups(copy)).toBe(lookups(g));
  return copy;
}

function terrainGame(): Game {
  const cols = 40;
  const rows = 30;
  const t = TerrainMap.flat(cols, rows);
  for (let p = 0; p < cols * rows; p++) t.setHeight(p, FLAT_HEIGHT + ((p % cols) >> 3)); // a gentle slope eastward
  const objects = new MapObjects(cols, rows);
  for (let p = 0; p < cols * rows; p++) {
    const x = p % cols;
    const y = Math.floor(p / cols);
    const clear = x >= 4 && x <= 30 && y >= 4 && y <= 20;
    if (!clear && (p * 2654435761) % 5 === 0) objects.set(p, MapObject.Tree);
  }
  const g = new Game(cols, rows, t, objects);
  g.limits = { ...DEFAULT_LIMITS };
  const castle = g.placeBuilding(T.Castle, g.index(10, 10), false);
  g.addStock(castle, Res.Plank, 20);
  g.addStock(castle, Res.Stone, 10);
  return g;
}

describe('saving a game', () => {
  it('survives JSON and gives back the same state', () => {
    const g = terrainGame();
    sc.run(g, 300);
    const text = JSON.stringify(g.serialize());
    const copy = Game.restore(JSON.parse(text));
    expect(JSON.stringify(copy.serialize())).toBe(text);
    expect(copy.tick).toBe(g.tick);
    expect(copy.castle).toBe(g.castle);
  });

  it('is a plain snapshot: later changes to the game do not reach it', () => {
    const g = terrainGame();
    const snap = g.serialize();
    const before = JSON.stringify(snap);
    sc.run(g, 500);
    g.placeBuilding(T.Lumberjack, g.index(14, 8), true);
    expect(JSON.stringify(snap)).toBe(before);
  });

  it('a logistics colony carries on identically, saved at many moments', () => {
    for (const at of [1, 37, 400, 1200, 3000]) {
      const g = new Game(16, 4);
      const f = sc.row(g, 1, 9, 1, 2);
      g.addBuilding(T.Castle, f[f.length - 1]!);
      g.addBuilding(T.Lumberjack, f[0]!);
      g.addBuilding(T.Sawmill, f[2]!);
      sc.run(g, at);
      carriesOn(g, 3000);
    }
  });

  it('construction: builders walking in, materials on the way, work in progress', () => {
    for (const at of [10, 150, 500, 900, 1600]) {
      const g = terrainGame();
      g.placeBuilding(T.Lumberjack, g.index(16, 10), true);
      g.placeBuilding(T.Sawmill, g.index(20, 10), true);
      link(g, 17, 11, 21, 11);
      link(g, 11, 11, 17, 11);
      sc.run(g, at);
      carriesOn(g, 4000);
    }
  });

  it('harvesters out at their trees, foresters planting, saplings growing', () => {
    for (const at of [20, 300, 1000, 2500]) {
      const g = new Game(30, 20, undefined, new MapObjects(30, 20));
      g.objects!.set(g.index(10, 7), MapObject.Tree);
      g.objects!.set(g.index(9, 8), MapObject.Stone, 5);
      g.placeBuilding(T.Lumberjack, g.index(7, 5), false);
      g.placeBuilding(T.Stonecutter, g.index(11, 6), false);
      g.placeBuilding(T.Forester, g.index(15, 10), false);
      g.objects!.plant(g.index(20, 12), 700);
      sc.run(g, at);
      const copy = carriesOn(g, 5000);
      expect(copy.objects!.count(MapObject.Tree) + copy.objects!.count(MapObject.Sapling)).toBeGreaterThan(0);
    }
  });

  it('a demolished road, a merged flag, a burning building, lost goods', () => {
    const g = terrainGame();
    const mill = g.placeBuilding(T.Sawmill, g.index(18, 10), false);
    const lj = g.placeBuilding(T.Lumberjack, g.index(14, 8), false);
    link(g, 11, 11, 19, 11);
    const mid = g.addFlag(14, 11);
    sc.run(g, 1500);
    g.demolishFlag(mid);
    g.addFlag(15, 11);
    sc.run(g, 200);
    g.demolishBuilding(lj);
    sc.run(g, 100);
    const road = g.roadIndexAt(g.index(13, 11));
    if (road >= 0) g.demolishRoad(road);
    sc.run(g, 100); // a burning building, a removed road and flag, goods lost
    expect(g.buildings[lj]!.burning).toBeGreaterThan(0);
    const bin = g.placeBuilding(T.Sawmill, g.index(22, 6), false);
    g.addStock(bin, Res.Lumber, 4);
    g.demolishBuilding(bin); // four lumber destroyed
    expect(g.lost[Res.Lumber]).toBeGreaterThanOrEqual(4);
    expect(g.roads.some((r) => r.removed) && g.flags.some((f) => f.removed)).toBe(true);
    const copy = carriesOn(g, 3000);
    expect(copy.lost[Res.Lumber]).toBe(g.lost[Res.Lumber]);
    expect(copy.buildings[mill]!.removed).toBe(false);
    expect(copy.buildings[lj]!.removed).toBe(true); // it burnt out on the way
  });

  it('store capacity, incoming goods and limits come back', () => {
    const g = new Game(16, 4);
    g.limits = { castle: 5, storage: 3 };
    const f = sc.row(g, 1, 9, 1, 2);
    g.addBuilding(T.Castle, f[f.length - 1]!);
    g.addBuilding(T.Lumberjack, f[2]!);
    sc.run(g, 2000);
    const copy = carriesOn(g, 3000);
    expect(copy.limits).toEqual({ castle: 5, storage: 3 });
    expect(copy.buildings[copy.castle]!.capacity).toBe(5);
  });

  it('the food chain', () => {
    const g = new Game(30, 4);
    const f = sc.row(g, 1, 21, 1, 2);
    for (const [i, t] of [T.Farm, T.Mill, T.Baker, T.Well, T.StoneMine].entries()) g.addBuilding(t, f[i]!);
    g.addBuilding(T.Castle, f[10]!);
    sc.run(g, 9000);
    expect(g.created[Res.Bread]).toBeGreaterThan(0);
    carriesOn(g, 6000);
  });

  it('keeps going when the player acts after loading', () => {
    const g = terrainGame();
    g.placeBuilding(T.Lumberjack, g.index(16, 10), true);
    link(g, 11, 11, 17, 11);
    sc.run(g, 700);
    carriesOn(g, 3000, (game) => {
      game.placeBuilding(T.Forester, game.index(16, 14), true);
      game.addFlag(14, 11); // cuts the road
      const from = game.flagAtPos(game.index(17, 15));
      game.addRoad(from, planRoad(game, from, game.index(14, 11))!);
    });
  });

  it('a game without terrain relief or objects round-trips too', () => {
    const g = new Game(10, 6);
    const f = sc.row(g, 1, 5, 1, 2);
    g.addBuilding(T.Castle, f[2]!);
    expect(g.objects).toBeNull();
    const copy = carriesOn(g, 500);
    expect(copy.objects).toBeNull();
    expect(copy.terrain.height).toEqual(g.terrain.height);
  });
});

describe('refusing bad data', () => {
  const good = () => {
    const g = new Game(10, 6);
    const f = sc.row(g, 1, 5, 1, 2);
    g.addBuilding(T.Castle, f[2]!);
    return g.serialize();
  };

  it('a different version', () => {
    const d = good();
    d.version = SAVE_VERSION + 1;
    expect(() => Game.restore(d)).toThrow(/version/);
  });

  it('terrain of the wrong size', () => {
    const d = good();
    d.heights = d.heights.slice(4);
    expect(() => Game.restore(d)).toThrow();
  });

  it('a road between flags that are not there', () => {
    const d = good();
    d.roads[0]!.flag = [0, 99];
    expect(() => Game.restore(d)).toThrow(/road/);
  });

  it('a flag off the map', () => {
    const d = good();
    d.flags[0]!.pos = 9999;
    expect(() => Game.restore(d)).toThrow(/outside/);
  });

  it('a carrier on a road that is not there', () => {
    const d = good();
    d.transporters = [{ road: 42, at: 0, state: 0, item: { type: -1, dest: -1, dir: -1 }, counter: 0, tick: 0, carriedTotal: 0, gone: false, idle: 0 }];
    expect(() => Game.restore(d)).toThrow(/carrier/);
  });

  it('is not fooled by a wrong tick or by missing sections', () => {
    const d = good() as unknown as Record<string, unknown>;
    delete d.flags;
    expect(() => Game.restore(d as never)).toThrow();
  });
});

describe('what a save costs', () => {
  it('a full-size map with a busy colony is a modest string', () => {
    const t = generateTerrain({ cols: 48, rows: 40, seed: 1 });
    const g = new Game(48, 40, t, generateObjects(t, 1));
    const f = sc.row(g, 20, 30, 20, 2);
    void f;
    const text = JSON.stringify(g.serialize());
    expect(text.length).toBeLessThan(120_000);
  });

  it('TerrainMap is exported for tests that need it', () => {
    expect(TerrainMap.flat(2, 2).height.length).toBe(4);
  });
});
