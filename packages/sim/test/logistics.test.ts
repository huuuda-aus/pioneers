// Behaviour tests, ported from logistics/main.cc. Exact numbers are pinned by
// parity.test.ts; these assert the properties the numbers are meant to show.
import { describe, expect, it } from 'vitest';
import { BuildingType, BState, CASTLE_BUILDERS, CASTLE_CARRIERS, Dir, Game, RES_COUNT, Res, TState, canPlaceFlag, planRoad, STORAGE_BUILDERS, STORAGE_CARRIERS, MAX_STEP_TICKS, MIN_STEP_TICKS, SLOPE_TICKS, STEP_TICKS, stepTicks } from '../src/index.ts';
import * as sc from './scenarios.ts';

/** Every item ever made and not consumed must exist somewhere. */
function checkConservation(g: Game): void {
  for (let r = 0; r < RES_COUNT; r++) {
    expect(g.created[r]! - g.consumed[r]!, `res ${r} at tick ${g.tick}`).toBe(g.countItems(r as Res));
  }
  for (const b of g.buildings) {
    for (let r = 0; r < RES_COUNT; r++) expect(b.requested[r]!).toBeGreaterThanOrEqual(0);
  }
}

const conserve: sc.Hook = (g, i) => {
  if (i % 25 === 0) checkConservation(g);
};

describe('conservation', () => {
  it('holds through the fast chain', () => {
    const c = sc.chain(2, 150, 15000, conserve);
    checkConservation(c.game);
  });
  it('holds through the overflow chain (hiring + storage dispatch)', () => {
    const c = sc.chain(-1, 300, 15000, conserve);
    checkConservation(c.game);
  });
  it('holds through the bootstrap economy', () => {
    const b = sc.bootstrap(conserve);
    checkConservation(b.game);
  });
});

describe('road capacity', () => {
  it('long roads throttle output and more carriers fix it', () => {
    const split = sc.lumberMade(2, 1, conserve).lumber_made;
    const long = sc.lumberMade(8, 1, conserve).lumber_made;
    const busy = sc.lumberMade(8, 3, conserve).lumber_made;
    expect(split).toBeGreaterThanOrEqual(70);
    expect(long).toBeLessThan((split * 8) / 10);
    expect(busy).toBeGreaterThan(long);
  });
});

describe('carrier hiring', () => {
  it('beats one fixed carrier on the overflow chain, within caps', () => {
    const fixed = sc.chain(1, 300, 15000);
    const dyn = sc.chain(-1, 300, 15000);
    // Storage dispatch sends surplus back to the sawmill: extra trips through
    // the same short roads, so this stays below the sawmill's ceiling.
    expect(dyn.planks_made).toBeGreaterThanOrEqual(65);
    expect(dyn.planks_made).toBeGreaterThanOrEqual(fixed.planks_made + 8);
    expect(dyn.lumber_stored).toBeGreaterThan(0);
    expect(dyn.max_on_road).toBeGreaterThanOrEqual(2);
    expect(dyn.roads_with_none).toBe(0);
    for (const r of dyn.game.roads) {
      expect(r.carriers.length).toBeLessThanOrEqual(Game.maxCarriers(r.length));
    }
  });

  it('matches generous fixed carriers when the sawmill is fast', () => {
    const fixed = sc.chain(2, 150, 15000);
    const dyn = sc.chain(-1, 150, 15000);
    expect(dyn.planks_made).toBeGreaterThanOrEqual(120);
    expect(dyn.planks_made * 10).toBeGreaterThanOrEqual(fixed.planks_made * 9);
  });

  it('keeps a long road near full rate within its cap', () => {
    const r = sc.longRoad();
    expect(r.lumber_made).toBeGreaterThanOrEqual(70);
    expect(r.carriers).toBeGreaterThanOrEqual(2);
    expect(r.carriers).toBeLessThanOrEqual(Game.maxCarriers(8));
  });

  it('stops exactly at the cap for a flooding producer', () => {
    expect(sc.hiringCap().carriers).toBe(Game.maxCarriers(4));
  });

  it('sends a carrier who walks from the storage', () => {
    const g = new Game(12, 4);
    const f = sc.row(g, 1, 5, 1, 4);
    g.addBuilding(BuildingType.Lumberjack, f[0]!);
    const st = g.addBuilding(BuildingType.Storage, f[1]!);
    g.update();
    expect(g.roads[0]!.carriers.length).toBe(1);
    expect(g.transporters[0]!.state).toBe(TState.Arriving);
    expect(g.buildings[st]!.carriers).toBe(STORAGE_CARRIERS - 1);
    sc.run(g, 150); // 4 tiles * 80 ticks at speed 2 = 160 steps
    expect(g.transporters[0]!.state).toBe(TState.Arriving);
    sc.run(g, 20);
    expect(g.transporters[0]!.state).not.toBe(TState.Arriving);
    expect(g.transporters[0]!.at).toBe(0);
  });

  it('handles an exhausted pool without losing items', () => {
    const r = sc.poolExhausted(conserve);
    expect(r.hired).toBe(1);
    expect(r.pool).toBe(0);
    expect(r.stored).toBe(0); // nothing crosses unstaffed roads
  });
});

describe('back-pressure and routing', () => {
  it('a producer with nowhere to send fills its flag, blocks and stops', () => {
    const g = new Game(8, 4);
    const a = g.addFlag(1, 1);
    g.addFlag(5, 1);
    g.addRoad(a, new Array<Dir>(4).fill(Dir.Right));
    g.addBuilding(BuildingType.Lumberjack, a);
    sc.run(g, 10000, conserve);
    const onFlag = g.flags[a]!.slot.filter((it) => it.type === Res.Lumber).length;
    expect(onFlag).toBe(8);
    expect(g.buildings[0]!.state).toBe(BState.OutputBlocked);
    expect(g.created[Res.Lumber]).toBe(9);
  });

  it('routes by fewest hops: the detour carries nothing', () => {
    const g = new Game(12, 8);
    const p = g.addFlag(1, 1);
    const t = g.addFlag(5, 1);
    const m = g.addFlag(1, 4);
    const direct = g.addRoad(p, new Array<Dir>(4).fill(Dir.Right));
    const leg1 = g.addRoad(p, [Dir.Down, Dir.Down, Dir.Down]);
    const leg2 = g.addRoad(m, [Dir.Right, Dir.Right, Dir.Right, Dir.Right, Dir.Up, Dir.Up, Dir.Up]);
    g.addBuilding(BuildingType.Lumberjack, p);
    g.addBuilding(BuildingType.Storage, t);
    sc.run(g, 6000, conserve);
    expect(g.transporters[g.roads[direct]!.carriers[0]!]!.carriedTotal).toBeGreaterThan(0);
    expect(g.roads[leg1]!.carriers.every((ti) => g.transporters[ti]!.carriedTotal === 0)).toBe(true);
    expect(g.roads[leg2]!.carriers.every((ti) => g.transporters[ti]!.carriedTotal === 0)).toBe(true);
    expect(g.buildings[1]!.stock[Res.Lumber]).toBeGreaterThan(0);
  });
});

describe('placement', () => {
  it('rejects invalid roads and flags', () => {
    const g = new Game(10, 6);
    const a = g.addFlag(1, 1);
    const b = g.addFlag(5, 1);
    const c = g.addFlag(3, 3);
    g.addRoad(a, new Array<Dir>(4).fill(Dir.Right));
    const R = Dir.Right;
    expect(() => g.addRoad(a, [R, R, R, R])).toThrow('direction in use');
    expect(() => g.addRoad(c, [Dir.Up, Dir.Up, Dir.Left])).toThrow(); // ends mid-road
    expect(() => g.addRoad(c, [R])).toThrow('road must end on a flag');
    expect(() => g.addRoad(a, [Dir.Left, Dir.Left])).toThrow('road leaves grid');
    expect(() => g.addRoad(b, [Dir.Left, Dir.Left])).toThrow(); // runs over road tiles
    expect(() => g.addFlag(1, 1)).toThrow('position occupied'); // an existing flag
    expect(() => g.addRoad(a, [R], 0)).toThrow();
  });

  it('does not allow two buildings on one flag', () => {
    const g = new Game(6, 4);
    const f = g.addFlag(1, 1);
    g.addBuilding(BuildingType.Storage, f);
    expect(() => g.addBuilding(BuildingType.Lumberjack, f)).toThrow('already has building');
  });
});

describe('construction', () => {
  it('builds a site from stored planks, then it produces', () => {
    const r = sc.siteBuilt((g, i) => {
      if (i % 25 === 0) checkConservation(g);
    });
    expect(r.done).toBeGreaterThanOrEqual(0);
    const b = r.game.buildings[r.site]!;
    expect(b.used[Res.Plank]).toBe(2);
    expect(b.requested[Res.Plank]).toBe(0);
    expect(r.builders_home).toBe(STORAGE_BUILDERS);
    expect(r.lumber_after).toBeGreaterThan(0);
    expect(r.planks_left).toBe(8);
  });

  it('produces nothing while under construction', () => {
    const c = new sc.Colony();
    c.g.addStock(c.storage, Res.Plank, 10);
    const site = c.g.addBuilding(BuildingType.Lumberjack, c.f[0]!, true);
    sc.run(c.g, 1200, (g) => {
      if (g.buildings[site]!.constructing) expect(g.created[Res.Lumber]).toBe(0);
    });
  });

  it('waits for missing material, then finishes once restocked', () => {
    const r = sc.siteWaits(conserve);
    expect(r.constructing_before).toBe(1);
    expect(r.used_before).toBe(1);
    expect(r.requested_before).toBe(0);
    expect(r.constructing_after).toBe(0);
  });

  it('serves sites one at a time with a single builder', () => {
    const one = sc.builders(1, conserve);
    const many = sc.builders(3, conserve);
    const gap = (r: { finish_a: number; finish_b: number }) => Math.abs(r.finish_b - r.finish_a);
    expect(one.finish_a).toBeGreaterThanOrEqual(0);
    expect(one.finish_b).toBeGreaterThanOrEqual(0);
    expect(gap(one)).toBeGreaterThanOrEqual(200); // BUILD_UNIT_TICKS
    expect(gap(many)).toBeLessThan(gap(one));
  });

  it('bootstraps: a third building is paid for with planks the colony made', () => {
    const b = sc.bootstrap();
    expect(b.ordered).toBeGreaterThan(0);
    expect(b.done).toBeGreaterThan(b.ordered);
    expect(b.planks_made - 4).toBeGreaterThanOrEqual(2);
    expect(b.stone_created).toBe(1);
    expect(b.game.buildings[b.storage]!.stock[Res.Stone]).toBe(0);
  });

  it('gets stone from a stonecutter the colony built', () => {
    const r = sc.stoneSupply(conserve);
    expect(r.done).toBeGreaterThan(0);
    expect(r.stoneUsed).toBe(1);
  });

  it('a finished storage starts supplying carriers and builders', () => {
    const r = sc.storageSite(conserve);
    expect(r.carriers_before).toBe(0);
    expect(r.builders_before).toBe(0);
    expect(r.constructing).toBe(0);
    expect(r.carriers).toBeGreaterThan(0);
    expect(r.builders).toBe(STORAGE_BUILDERS);
  });
});

describe('road planner', () => {
  it('finds a shortest valid path and addRoad accepts it', () => {
    const g = new Game(12, 8);
    const a = g.addFlag(1, 1);
    const b = g.addFlag(6, 4);
    const path = planRoad(g, a, g.flags[b]!.pos);
    expect(path).not.toBeNull();
    // (1,1) -> (6,4): 3 diagonal DownRight + 2 Right = 5 tiles.
    expect(path!.length).toBe(5);
    expect(() => g.addRoad(a, path!)).not.toThrow();
  });

  it('routes around obstacles and refuses when impossible', () => {
    const g = new Game(8, 5);
    const a = g.addFlag(1, 2);
    const b = g.addFlag(5, 2);
    g.addFlag(3, 2); // blocks the straight line
    const path = planRoad(g, a, g.flags[b]!.pos);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(4);
    g.addRoad(a, path!);
    // A parallel road through other directions is legal; it must differ from
    // the first and be accepted by addRoad.
    const second = planRoad(g, a, g.flags[b]!.pos);
    expect(second).not.toBeNull();
    expect(second![0]).not.toBe(path![0]);
    expect(() => g.addRoad(a, second!)).not.toThrow();
    expect(planRoad(g, a, g.index(0, 0))).toBeNull(); // not a flag
    expect(planRoad(g, a, g.flags[a]!.pos)).toBeNull(); // to itself
  });

  it('knows where flags can go', () => {
    const g = new Game(8, 5);
    const a = g.addFlag(1, 1);
    const b = g.addFlag(3, 1);
    g.addRoad(a, [Dir.Right, Dir.Right]);
    expect(canPlaceFlag(g, 2, 1)).toBe(false); // road tile
    expect(canPlaceFlag(g, 1, 1)).toBe(false); // flag
    expect(canPlaceFlag(g, 4, 1)).toBe(false); // next to the flag at (3,1)
    expect(canPlaceFlag(g, 5, 1)).toBe(true);
    expect(canPlaceFlag(g, -1, 1)).toBe(false);
    expect(b).toBe(1);
  });
});

describe('castle', () => {
  it('is a store with a big crew, known to the game', () => {
    const c = new sc.CastleColony();
    const b = c.g.buildings[c.castle]!;
    expect(c.g.castle).toBe(c.castle);
    expect(b.carriers).toBe(CASTLE_CARRIERS);
    expect(b.builders).toBe(CASTLE_BUILDERS);
    expect(b.constructing).toBe(false);
    expect(CASTLE_CARRIERS).toBeGreaterThan(STORAGE_CARRIERS);
  });

  it('is unique and cannot be built', () => {
    const c = new sc.CastleColony();
    expect(() => c.g.addBuilding(BuildingType.Castle, c.f[0]!)).toThrow('only one castle');

    const g = new Game(8, 4);
    const f = g.addFlag(1, 1);
    expect(() => g.addBuilding(BuildingType.Castle, f, true)).toThrow('cannot be built');
    expect(g.castle).toBe(-1); // a failed placement leaves nothing behind
    expect(g.flags[f]!.building).toBe(-1);
    g.addBuilding(BuildingType.Castle, f); // the flag is still usable
    expect(g.castle).toBe(0);
  });

  it('feeds construction: stock out, crew out, builder back, output stored', () => {
    const r = sc.castleSite(conserve);
    expect(r.done).toBeGreaterThanOrEqual(0);
    expect(r.game.buildings[r.site]!.used[Res.Plank]).toBe(2);
    expect(r.builders_left).toBe(CASTLE_BUILDERS);
    expect(r.carriers_left).toBe(CASTLE_CARRIERS - r.hired);
    expect(r.lumber_stored).toBeGreaterThan(0);
    expect(r.planks_left).toBe(8);
  });

  it('bootstraps an economy and keeps conservation', () => {
    const b = sc.castleBootstrap(conserve);
    expect(b.done).toBeGreaterThan(b.ordered);
    expect(b.dispatched_planks).toBeGreaterThanOrEqual(4);
    checkConservation(b.game);
  });

  it('shows as K on the ASCII map', () => {
    const c = new sc.CastleColony();
    expect(c.g.render()).toContain('K');
  });
});

describe('slopes', () => {
  it('make climbing slower and descending quicker, within limits', () => {
    expect(stepTicks(0)).toBe(STEP_TICKS);
    expect(stepTicks(1)).toBe(STEP_TICKS + SLOPE_TICKS);
    expect(stepTicks(-1)).toBe(STEP_TICKS - SLOPE_TICKS);
    expect(stepTicks(100)).toBe(MAX_STEP_TICKS);
    expect(stepTicks(-100)).toBe(MIN_STEP_TICKS);
  });

  it('give a road a different walking time each way; level roads keep the old time', () => {
    const g = new Game(12, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 12; x++) g.terrain.setHeight(g.index(x, y), 10 + x);
    const a = g.addFlag(1, 1);
    g.addFlag(5, 1);
    const r = g.roads[g.addRoad(a, new Array<Dir>(4).fill(Dir.Right))]!;
    expect(r.ticks[0]).toBe(4 * stepTicks(1));
    expect(r.ticks[1]).toBe(4 * stepTicks(-1));
    expect(r.ticks[0]).toBeGreaterThan(r.ticks[1]);

    const flat = new Game(12, 4);
    const fa = flat.addFlag(1, 1);
    flat.addFlag(5, 1);
    const fr = flat.roads[flat.addRoad(fa, new Array<Dir>(4).fill(Dir.Right))]!;
    expect(fr.ticks).toEqual([4 * STEP_TICKS, 4 * STEP_TICKS]);
  });

  it('delay a hilltop site and speed up a valley site', () => {
    const climbing = sc.slopeSite(-3, conserve).done; // storage low, site high
    const level = sc.siteBuilt().done;
    const descending = sc.slopeSite(3, conserve).done;
    expect(climbing).toBeGreaterThan(level);
    expect(descending).toBeLessThan(level);
  });

  it('cost throughput only once a slope is steep enough to hit the floor', () => {
    const level = sc.lumberMade(8, 1).lumber_made; // same road, level
    expect(sc.slopeLumber(3).lumber_made).toBe(level); // climb + descent add up to a level trip
    expect(sc.slopeLumber(5).lumber_made).toBeLessThan(level);
  });
});
