// Demolition, as in the original: nothing is refunded. Stock in a demolished
// building and goods on a removed flag or in a removed road's carriers are
// lost for good; carriers whose road goes away return to a storage; a removed
// flag merges its two roads back into one.
import { describe, expect, it } from 'vitest';
import { BURN_TICKS, BuildingType, Dir, Game, RES_COUNT, Res, TState, TerrainMap } from '../src/index.ts';
import * as sc from './scenarios.ts';

const R = Dir.Right;
const at = (g: Game, x: number, y: number) => g.index(x, y);

/** Every unit ever made is consumed, lost, or still somewhere. */
function checkConservation(g: Game): void {
  for (let r = 0; r < RES_COUNT; r++) {
    expect(g.created[r]! - g.consumed[r]! - g.lost[r]!, `res ${r} at tick ${g.tick}`).toBe(g.countItems(r as Res));
  }
}

/** Live carriers are on exactly one live road each; gone ones are on none. */
function checkCarriers(g: Game): void {
  const seen = new Set<number>();
  for (const road of g.roads) {
    if (road.removed) expect(road.carriers).toEqual([]);
    for (const ti of road.carriers) {
      expect(g.transporters[ti]!.road).toBe(road.index);
      expect(g.transporters[ti]!.gone).toBe(false);
      expect(seen.has(ti)).toBe(false);
      seen.add(ti);
    }
  }
  expect(seen.size).toBe(g.transporters.filter((t) => !t.gone).length);
  for (const t of g.transporters) {
    if (t.gone) continue;
    const road = g.roads[t.road]!;
    if (t.state === TState.Walking) expect(t.counter).toBeLessThanOrEqual(road.ticks[t.at]! + 1);
  }
}

/** Carriers the castle can still send plus those working: the pool is never created or lost. */
const crew = (g: Game, castle: number) =>
  g.buildings[castle]!.carriers + g.transporters.filter((t) => !t.gone).length;

describe('demolishing a road', () => {
  function colony() {
    const c = new sc.CastleColony(); // flags x=1,3,5,7,9 on row 1; castle at the last
    const g = c.g;
    g.addBuilding(BuildingType.Lumberjack, c.f[0]!);
    return { c, g };
  }

  it('unlinks both flags and frees the road tile', () => {
    const { g } = colony();
    const v = g.layoutVersion;
    g.demolishRoad(1); // between x=3 and x=5
    expect(g.roads[1]!.removed).toBe(true);
    expect(g.flags[1]!.road[Dir.Right]).toBe(-1);
    expect(g.flags[2]!.road[Dir.Left]).toBe(-1);
    expect(g.roadAtPos(at(g, 4, 1))).toBe(false);
    expect(g.layoutVersion).toBeGreaterThan(v);
    expect(() => g.demolishRoad(1)).toThrow(); // already gone
  });

  it('sends its carriers home and loses what they were carrying', () => {
    const { c, g } = colony();
    g.addStock(c.castle, Res.Plank, 0);
    sc.run(g, 700);
    expect(crew(g, c.castle)).toBe(40);
    // cut where traffic is: the road right next to the lumberjack
    let hadItem = 0;
    for (let i = 0; i < 400 && !hadItem; i++) {
      g.update();
      for (const ti of g.roads[1]!.carriers) if (g.transporters[ti]!.item.type !== Res.None) hadItem++;
    }
    const lostBefore = g.lost.reduce((a, b) => a + b, 0);
    const n = g.roads[1]!.carriers.length;
    expect(n).toBeGreaterThan(0);
    g.demolishRoad(1);
    expect(g.lost.reduce((a, b) => a + b, 0) - lostBefore).toBe(hadItem);
    expect(g.transporters.filter((t) => t.gone).length).toBeGreaterThanOrEqual(n);
    expect(crew(g, c.castle)).toBe(40); // everyone is accounted for
    checkConservation(g);
    checkCarriers(g);
  });

  it('cuts the colony in two: goods pile up behind the gap, and flow again when it is rejoined', () => {
    const { c, g } = colony();
    sc.run(g, 1500);
    const castle = g.buildings[c.castle]!;
    g.demolishRoad(1);
    sc.run(g, 1200); // whatever was already past the gap arrives
    const stored = castle.stock[Res.Lumber]!;
    sc.run(g, 3000, (gg, i) => {
      if (i % 25 === 0) checkConservation(gg);
    });
    expect(castle.stock[Res.Lumber]).toBe(stored); // nothing gets through
    expect(g.flags[0]!.slot.some((s) => s.type !== Res.None)).toBe(true);
    // rejoin
    g.addRoad(1, [R, R]);
    sc.run(g, 3000, (gg, i) => {
      if (i % 25 === 0) checkConservation(gg);
    });
    expect(castle.stock[Res.Lumber]).toBeGreaterThan(stored);
    checkCarriers(g);
  });

  it('lets items take another way when there is one', () => {
    // a square: top row and a detour below; cutting the top still delivers
    const g = new Game(20, 10);
    const a = g.addFlag(1, 1);
    const b = g.addFlag(5, 1);
    const c = g.addFlag(1, 4);
    const d = g.addFlag(5, 4);
    g.addRoad(a, [R, R, R, R]);
    g.addRoad(a, [Dir.Down, Dir.Down, Dir.Down], -1);
    g.addRoad(c, [R, R, R, R]);
    g.addRoad(b, [Dir.Down, Dir.Down, Dir.Down], -1);
    g.addBuilding(BuildingType.Lumberjack, a);
    const castle = g.addBuilding(BuildingType.Castle, d);
    sc.run(g, 1200);
    g.demolishRoad(0); // the direct road a-b
    sc.run(g, 4000, (gg, i) => {
      if (i % 25 === 0) checkConservation(gg);
    });
    expect(g.buildings[castle]!.stock[Res.Lumber]).toBeGreaterThan(0);
    // a's lumber must have come the long way: a-c-d
    const before = g.buildings[castle]!.stock[Res.Lumber]!;
    sc.run(g, 2000);
    expect(g.buildings[castle]!.stock[Res.Lumber]).toBeGreaterThan(before);
  });
});

describe('demolishing a flag', () => {
  function line(terrain?: TerrainMap) {
    const g = new Game(14, 8, terrain);
    const a = g.addFlag(1, 1);
    const b = g.addFlag(7, 1);
    g.addRoad(a, [R, R, R, R, R, R]);
    return { g, a, b };
  }

  const shape = (g: Game, i: number) => {
    const r = g.roads[i]!;
    return { flag: r.flag, dirAt: r.dirAt, dirs: r.dirs, length: r.length, ticks: r.ticks };
  };

  it('is the exact inverse of splitting a road', () => {
    const { g } = line();
    const before = shape(g, 0);
    const f = g.addFlag(4, 1);
    expect(g.roads[1]!.removed).toBe(false);
    g.demolishFlag(f);
    expect(shape(g, 0)).toEqual(before);
    expect(g.roads[1]!.removed).toBe(true);
    expect(g.flags[f]!.removed).toBe(true);
    expect(g.flagAtPos(at(g, 4, 1))).toBe(-1);
    expect(g.roadIndexAt(at(g, 4, 1))).toBe(0);
    expect(g.flags[0]!.road[Dir.Right]).toBe(0);
    expect(g.flags[1]!.road[Dir.Left]).toBe(0);
    // and it can be split again at the same place, or anywhere else
    g.addFlag(4, 1);
    expect(g.roads.filter((r) => !r.removed).length).toBe(2);
  });

  it('is the inverse on a slope, with its asymmetric timing, and round a corner', () => {
    const t = TerrainMap.flat(14, 8);
    for (let x = 0; x < 14; x++) for (let y = 0; y < 8; y++) t.setHeight(y * 14 + x, 8 + x + (y > 1 ? 2 : 0));
    const g = new Game(14, 8, t);
    const a = g.addFlag(1, 1);
    g.addFlag(4, 3);
    g.addRoad(a, [R, R, Dir.DownRight, Dir.Down]);
    const before = shape(g, 0);
    const f = g.addFlag(3, 1); // 2 steps along, where the road turns
    expect(g.roads[0]!.ticks).not.toEqual(before.ticks);
    g.demolishFlag(f);
    expect(shape(g, 0)).toEqual(before);
  });

  it('merges roads regardless of which one is older or how they point', () => {
    const { g } = line();
    const f = g.addFlag(3, 1);
    const f2 = g.addFlag(5, 1);
    g.demolishFlag(f);
    expect(g.roads.filter((r) => !r.removed).map((r) => r.length).sort()).toEqual([2, 4]);
    g.demolishFlag(f2);
    expect(g.roads.filter((r) => !r.removed).map((r) => r.length)).toEqual([6]);
  });

  it('removes a flag with no roads', () => {
    const g = new Game(8, 8);
    const f = g.addFlag(3, 3);
    g.demolishFlag(f);
    expect(g.flagAtPos(at(g, 3, 3))).toBe(-1);
    g.addFlag(3, 3); // free to use again
  });

  it('refuses where it would break the network, and says why', () => {
    const g = new Game(14, 8);
    const a = g.addFlag(1, 1);
    const m = g.addFlag(4, 1);
    g.addFlag(7, 1);
    const c = g.addFlag(4, 4);
    g.addRoad(a, [R, R, R]);
    g.addRoad(m, [R, R, R]);
    g.addBuilding(BuildingType.Lumberjack, a);
    expect(g.checkDemolishFlag(a).reason).toMatch(/building/);
    g.addRoad(m, [Dir.Down, Dir.Down, Dir.Down]);
    expect(g.checkDemolishFlag(m).reason).toMatch(/fork/); // three roads
    expect(g.checkDemolishFlag(c).reason).toMatch(/road first/); // dead end
    expect(() => g.demolishFlag(m)).toThrow(/fork/);
    expect(g.flags[m]!.removed).toBe(false);

    // two roads that both lead to the same flag
    const h = new Game(14, 8);
    const p = h.addFlag(1, 1);
    const q = h.addFlag(4, 1);
    h.addRoad(p, [R, R, R]);
    h.addRoad(p, [Dir.DownRight, R, R, Dir.Up]);
    expect(h.checkDemolishFlag(q).reason).toMatch(/same flag/);
  });

  describe('with carriers and goods on the move', () => {
    function haul() {
      const g = new Game(16, 4);
      const f = sc.row(g, 1, 13, 1, 12); // one long road, fixed? no: dynamic
      g.addBuilding(BuildingType.Lumberjack, f[0]!);
      const castle = g.addBuilding(BuildingType.Castle, f[1]!);
      return { g, castle };
    }

    it('keeps every item and carrier across merges at many moments', () => {
      for (const cutAt of [150, 400, 777, 1300, 2100]) {
        const { g, castle } = haul();
        const mid = g.addFlag(7, 1);
        sc.run(g, cutAt, (gg, i) => {
          if (i % 40 === 0) checkConservation(gg);
        });
        const poolBefore = crew(g, castle);
        const kinds = Array.from({ length: RES_COUNT }, (_, r) => r);
        const goodsBefore = kinds.map((r) => g.countItems(r as Res));
        const onFlag = kinds.map((r) => g.flags[mid]!.slot.filter((s) => s.type === r).length);
        const lostBefore = [...g.lost];
        g.demolishFlag(mid);
        // only what lay on the flag is gone
        expect(g.lost.map((n, r) => n - lostBefore[r]!)).toEqual(onFlag);
        expect(kinds.map((r) => g.countItems(r as Res))).toEqual(goodsBefore.map((n, r) => n - onFlag[r]!));
        expect(crew(g, castle)).toBe(poolBefore);
        checkCarriers(g);
        const stored = g.buildings[castle]!.stock[Res.Lumber]!;
        sc.run(g, 3000, (gg, i) => {
          if (i % 40 === 0) checkConservation(gg);
        });
        checkCarriers(g);
        expect(g.buildings[castle]!.stock[Res.Lumber]).toBeGreaterThan(stored); // still works
      }
    });

    it('rescales a walking carrier to the merged road', () => {
      const { g } = haul();
      const mid = g.addFlag(7, 1);
      let ti = -1;
      for (let i = 0; i < 6000 && ti < 0; i++) {
        g.update();
        ti = g.transporters.findIndex(
          (t) => !t.gone && t.state === TState.Walking && t.item.type !== Res.None && t.at === 0 && t.road === 1,
        );
      }
      expect(ti).toBeGreaterThanOrEqual(0);
      const t = g.transporters[ti]!;
      const prog = 1 - t.counter / g.roads[1]!.ticks[0]!; // along the second half
      g.demolishFlag(mid);
      const merged = g.roads[0]!;
      expect(t.road).toBe(0);
      expect(t.at).toBe(0);
      const s = 6 + prog * 6; // steps from the start of the merged road
      expect(t.counter).toBe(Math.round(merged.ticks[0]! * (1 - s / 12)));
    });
  });
});

describe('demolishing a building', () => {
  function site() {
    const g = new Game(30, 16);
    const castle = g.placeBuilding(BuildingType.Castle, g.index(4, 4), false);
    g.addStock(castle, Res.Plank, 20);
    g.addStock(castle, Res.Stone, 10);
    const mill = g.placeBuilding(BuildingType.Sawmill, g.index(14, 4), true);
    g.addRoad(g.flagAtPos(g.index(5, 5)), new Array<Dir>(10).fill(R));
    return { g, castle, mill };
  }

  it('refuses the castle and a building that is already burning', () => {
    const { g, castle, mill } = site();
    expect(g.checkDemolishBuilding(castle).reason).toMatch(/castle/);
    expect(() => g.demolishBuilding(castle)).toThrow();
    g.demolishBuilding(mill);
    expect(g.checkDemolishBuilding(mill).reason).toMatch(/burning/);
  });

  it('destroys its stock for good and keeps its flag and roads', () => {
    const { g, mill } = site();
    sc.run(g, 2500);
    const b = g.buildings[mill]!;
    expect(b.constructing).toBe(false);
    g.addStock(mill, Res.Lumber, 5);
    const stock = b.stock[Res.Lumber]!;
    const lostBefore = g.lost[Res.Lumber]!;
    const door = b.flag;
    const roads = g.roads.filter((r) => !r.removed).length;
    g.demolishBuilding(mill);
    expect(g.lost[Res.Lumber]! - lostBefore).toBe(stock);
    expect(b.stock[Res.Lumber]).toBe(0);
    expect(g.flags[door]!.building).toBe(-1);
    expect(g.flags[door]!.removed).toBe(false);
    expect(g.roads.filter((r) => !r.removed).length).toBe(roads);
    checkConservation(g);
    sc.run(g, 200, (gg, i) => {
      if (i % 20 === 0) checkConservation(gg);
    });
    // the door flag is a plain flag now: the road still ends in it
    expect(g.checkDemolishFlag(door).reason).toMatch(/road first/);
  });

  it('burns for a while, keeping the ground blocked, then frees it', () => {
    const { g, mill } = site();
    sc.run(g, 2500);
    const pos = g.buildings[mill]!.pos;
    g.demolishBuilding(mill);
    expect(g.buildingAtPos(pos)).toBe(mill);
    expect(() => g.placeBuilding(BuildingType.Sawmill, pos)).toThrow(/in the way/);
    sc.run(g, Math.floor(BURN_TICKS / g.speed) - 5);
    expect(g.buildings[mill]!.removed).toBe(false);
    expect(g.buildingAtPos(pos)).toBe(mill);
    sc.run(g, 10);
    expect(g.buildings[mill]!.removed).toBe(true);
    expect(g.buildingAtPos(pos)).toBe(-1);
    // the same spot takes a new building, which gets built
    const again = g.placeBuilding(BuildingType.Sawmill, pos);
    sc.run(g, 3000);
    expect(g.buildings[again]!.constructing).toBe(false);
    expect(g.buildings[again]!.removed).toBe(false);
  });

  it('a construction site: materials are lost, the builder goes home', () => {
    const { g, castle, mill } = site();
    sc.run(g, 700); // builder has arrived and work has begun
    const b = g.buildings[mill]!;
    expect(b.constructing).toBe(true);
    expect(b.builder).not.toBe(0);
    const away = g.buildings[castle]!.builders;
    const inStock = b.stock[Res.Plank]! + b.stock[Res.Stone]!;
    const lost0 = g.lost[Res.Plank]! + g.lost[Res.Stone]!;
    g.demolishBuilding(mill);
    expect(g.buildings[castle]!.builders).toBe(away + 1);
    expect(g.lost[Res.Plank]! + g.lost[Res.Stone]! - lost0).toBe(inStock);
    sc.run(g, 1500, (gg, i) => {
      if (i % 25 === 0) checkConservation(gg);
    });
  });

  it('goods on their way to it find another home instead of vanishing', () => {
    const { g, mill } = site();
    const other = g.placeBuilding(BuildingType.Sawmill, g.index(14, 9), true);
    g.addRoad(g.flagAtPos(g.index(15, 10)), [Dir.Up, Dir.Up, Dir.Up, Dir.Up, Dir.Up]);
    sc.run(g, 150); // planks and stone are on their way
    g.demolishBuilding(mill);
    sc.run(g, 3500, (gg, i) => {
      if (i % 25 === 0) checkConservation(gg);
    });
    expect(g.buildings[other]!.constructing).toBe(false); // still got what it needed
  });

});
