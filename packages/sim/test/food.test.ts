// The food economy: only mines eat (fish or bread). Bread comes from a baker
// (flour from a mill, wheat from a farm, plus water from a well); fish from a
// fisher at the water. These tests use the plain-economy API on flat ground,
// then check the terrain rules separately.
import { describe, expect, it } from 'vitest';
import {
  BState,
  BuildingType,
  Dir,
  FOOD,
  Game,
  RES_COUNT,
  Res,
  TerrainMap,
  checkBuilding,
  priority,
} from '../src/index.ts';
import * as sc from './scenarios.ts';

const T = BuildingType;
const at = (g: Game, x: number, y: number) => g.index(x, y);

function checkConservation(g: Game): void {
  for (let r = 0; r < RES_COUNT; r++) {
    expect(g.created[r]! - g.consumed[r]! - g.lost[r]!, `res ${r} at tick ${g.tick}`).toBe(g.countItems(r as Res));
  }
}

/** One finished building of `type` on a single flag, nothing else. */
function solo(type: BuildingType) {
  const g = new Game(8, 6);
  const f = g.addFlag(3, 3);
  const b = g.addBuilding(type, f);
  return { g, b: g.buildings[b]!, flag: g.flags[f]! };
}

describe('who eats what', () => {
  it('a mine takes either food, a baker takes flour and water, a mill takes wheat', () => {
    const mine = solo(T.StoneMine).b;
    expect(priority(mine, Res.Fish)).toBeGreaterThan(0);
    expect(priority(mine, Res.Bread)).toBeGreaterThan(0);
    for (const r of [Res.Lumber, Res.Plank, Res.Stone, Res.Wheat, Res.Flour, Res.Water]) {
      expect(priority(mine, r), `mine and ${Res[r]}`).toBe(0);
    }
    const baker = solo(T.Baker).b;
    expect(priority(baker, Res.Flour)).toBeGreaterThan(0);
    expect(priority(baker, Res.Water)).toBeGreaterThan(0);
    expect(priority(baker, Res.Wheat)).toBe(0);
    expect(priority(solo(T.Mill).b, Res.Wheat)).toBeGreaterThan(0);
  });

  it('nothing else eats: carriers, lumberjacks, foresters, stonecutters want no food', () => {
    for (const type of [T.Lumberjack, T.Forester, T.Stonecutter, T.Sawmill, T.Fisher, T.Farm, T.Well]) {
      const b = solo(type).b;
      for (const r of FOOD) expect(priority(b, r), `${T[type]} and ${Res[r]}`).toBe(0);
    }
  });

  it('a mine counts fish and bread together towards what it will stock', () => {
    const mine = solo(T.StoneMine).b;
    mine.stock[Res.Fish] = 3;
    mine.requested[Res.Bread] = 1; // 4 = maxIn: full, whichever food it is
    expect(priority(mine, Res.Fish)).toBe(0);
    expect(priority(mine, Res.Bread)).toBe(0);
    mine.requested[Res.Bread] = 0;
    expect(priority(mine, Res.Bread)).toBeGreaterThan(0);
  });
});

describe('producers', () => {
  it('well, farm and fisher need no input and make water, wheat and fish', () => {
    for (const [type, out, period] of [[T.Well, Res.Water, 350], [T.Farm, Res.Wheat, 700], [T.Fisher, Res.Fish, 500]] as const) {
      const { g, b } = solo(type);
      sc.run(g, Math.ceil(period / g.speed) + 3);
      expect(g.created[out], T[type]).toBeGreaterThanOrEqual(1);
      expect(b.out).toBe(out);
    }
  });

  it('a mill turns one wheat into one flour', () => {
    const { g, b } = solo(T.Mill);
    g.addStock(g.buildings.indexOf(b), Res.Wheat, 2);
    sc.run(g, 600);
    expect(g.created[Res.Flour]).toBe(2);
    expect(g.consumed[Res.Wheat]).toBe(2);
  });

  it('a baker waits for both flour and water, then uses one of each per loaf', () => {
    const { g, b } = solo(T.Baker);
    const bi = g.buildings.indexOf(b);
    g.addStock(bi, Res.Flour, 3);
    sc.run(g, 1000);
    expect(g.created[Res.Bread]).toBe(0); // no water
    expect(b.state).toBe(BState.Idle);
    g.addStock(bi, Res.Water, 1);
    sc.run(g, 600);
    expect(g.created[Res.Bread]).toBe(1);
    expect([g.consumed[Res.Flour], g.consumed[Res.Water]]).toEqual([1, 1]);
    expect([b.stock[Res.Flour], b.stock[Res.Water]]).toEqual([2, 0]);
    checkConservation(g);
  });

  it('a mine works on fish alone, or on bread alone, one unit per stone', () => {
    for (const food of [Res.Fish, Res.Bread]) {
      const { g, b } = solo(T.StoneMine);
      g.addStock(g.buildings.indexOf(b), food, 2);
      sc.run(g, 1500);
      expect(g.created[Res.Stone], Res[food]).toBe(2);
      expect(g.consumed[food]).toBe(2);
      expect(b.state).toBe(BState.Idle); // out of food: stops, nothing else happens
    }
  });

  it('a mine with no food does nothing, however long', () => {
    const { g } = solo(T.StoneMine);
    sc.run(g, 5000);
    expect(g.created[Res.Stone]).toBe(0);
  });
});

describe('the whole chain', () => {
  function chain() {
    const g = new Game(30, 4);
    const f = sc.row(g, 1, 21, 1, 2); // 11 flags in a row
    g.addBuilding(T.Farm, f[0]!);
    g.addBuilding(T.Mill, f[1]!);
    g.addBuilding(T.Baker, f[2]!);
    g.addBuilding(T.Well, f[3]!);
    const mine = g.addBuilding(T.StoneMine, f[4]!);
    const castle = g.addBuilding(T.Castle, f[10]!);
    return { g, mine, castle };
  }

  it('farm → mill → baker (+ well) → mine → stone, with nothing lost or invented', () => {
    const { g, mine, castle } = chain();
    sc.run(g, 40000, (gg, i) => {
      if (i % 50 === 0) checkConservation(gg);
    });
    for (const r of [Res.Wheat, Res.Flour, Res.Water, Res.Bread, Res.Stone]) {
      expect(g.created[r], Res[r]).toBeGreaterThan(0);
    }
    expect(g.created[Res.Stone]).toBeGreaterThan(5);
    // every stone the mine made is a bread it ate (no fish here)
    expect(g.consumed[Res.Bread]).toBeGreaterThanOrEqual(g.created[Res.Stone]! - 1);
    expect(g.buildings[castle]!.stock[Res.Stone]! + g.buildings[mine]!.stock[Res.Stone]!).toBeGreaterThan(0);
  });

  it('cut the baker off and the mine stops once its bread runs out', () => {
    const { g, mine } = chain();
    sc.run(g, 20000);
    g.demolishRoad(g.flags[2]!.road[Dir.Right]!); // between the baker and the well
    sc.run(g, 8000); // drain what was in flight
    const before = g.created[Res.Stone]!;
    sc.run(g, 12000);
    expect(g.created[Res.Stone]).toBe(before); // starved
    expect(g.buildings[mine]!.stock[Res.Bread]).toBe(0);
  });
});

describe('where they can stand', () => {
  /** 24x16 flat grass with a lake on the left and a mountain on the right. */
  function land() {
    const t = TerrainMap.flat(24, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 24; x++) {
        if (x <= 3) t.setHeight(y * 24 + x, 4); // water
        if (x === 4) t.setHeight(y * 24 + x, 6); // a gentle shore
        if (x >= 18) t.setHeight(y * 24 + x, 20); // mountain
      }
    }
    return new Game(24, 16, t);
  }

  it('only mines go on mountains, and mines only go on mountains', () => {
    const g = land();
    expect(checkBuilding(g, T.StoneMine, at(g, 20, 8)).ok).toBe(true);
    expect(checkBuilding(g, T.Lumberjack, at(g, 20, 8)).reason).toMatch(/mountain/);
    expect(checkBuilding(g, T.StoneMine, at(g, 10, 8)).reason).toMatch(/mines go on mountains/);
  });

  it('a mine still keeps off the water', () => {
    const t = TerrainMap.flat(24, 16, 20);
    for (let y = 0; y < 16; y++) t.setHeight(y * 24 + 6, 4);
    const g = new Game(24, 16, t);
    expect(checkBuilding(g, T.StoneMine, at(g, 7, 8)).reason).toMatch(/water/);
  });

  it('a fisher needs water within reach, and may stand right at the shore', () => {
    const g = land();
    expect(checkBuilding(g, T.Fisher, at(g, 5, 8)).ok).toBe(true); // 2 steps from the lake
    expect(checkBuilding(g, T.Fisher, at(g, 4, 8)).ok).toBe(true); // touching it
    expect(checkBuilding(g, T.Fisher, at(g, 12, 8)).reason).toMatch(/no water within reach/);
    expect(checkBuilding(g, T.Fisher, at(g, 2, 8)).ok).toBe(false); // not in it
    expect(checkBuilding(g, T.Lumberjack, at(g, 4, 8)).reason).toMatch(/water/); // others still keep off
  });

  it('farm, mill and baker are big buildings; well and fisher are small', () => {
    const g = land();
    for (const type of [T.Farm, T.Mill, T.Baker]) {
      expect(checkBuilding(g, type, at(g, 10, 8)).footprint.length, T[type]).toBe(4);
    }
    for (const type of [T.Well, T.Fisher, T.StoneMine]) {
      expect(checkBuilding(g, type, at(g, 10, 8)).footprint.length, T[type]).toBe(1);
    }
  });
});
