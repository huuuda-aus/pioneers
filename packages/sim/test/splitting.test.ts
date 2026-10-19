// Flags on roads: a flag put anywhere along a road, corners included, cuts it
// in two and lets a new road branch off. Items must never be lost, and
// carriers must keep working across the cut.
import { describe, expect, it } from 'vitest';
import {
  BuildingType,
  Dir,
  Game,
  RES_COUNT,
  Res,
  TState,
  checkFlagAt,
  planRoad,
  stepTicks,
  STEP_TICKS,
} from '../src/index.ts';
import * as sc from './scenarios.ts';

const R = Dir.Right;
const at = (g: Game, x: number, y: number) => g.index(x, y);

function checkConservation(g: Game): void {
  for (let r = 0; r < RES_COUNT; r++) {
    expect(g.created[r]! - g.consumed[r]!, `res ${r} at tick ${g.tick}`).toBe(g.countItems(r as Res));
  }
}

/** Every carrier is on exactly one road, and every road knows its carriers. */
function checkCarrierBookkeeping(g: Game): void {
  const seen = new Set<number>();
  for (const road of g.roads) {
    for (const ti of road.carriers) {
      expect(g.transporters[ti]!.road).toBe(road.index);
      expect(seen.has(ti)).toBe(false);
      seen.add(ti);
    }
  }
  expect(seen.size).toBe(g.transporters.length);
  for (const t of g.transporters) {
    const road = g.roads[t.road]!;
    expect(t.at === 0 || t.at === 1).toBe(true);
    if (t.state === TState.Walking) {
      expect(t.counter).toBeLessThanOrEqual(road.ticks[t.at]! + 1);
    }
  }
}

describe('splitting a road with a flag', () => {
  it('cuts it into two roads that meet at the new flag', () => {
    const g = new Game(14, 8);
    const a = g.addFlag(1, 1);
    const b = g.addFlag(7, 1);
    g.addRoad(a, new Array<Dir>(6).fill(R));
    const v = g.layoutVersion;
    const f = g.addFlag(4, 1);

    expect(g.flags.length).toBe(3);
    expect(g.roads.length).toBe(2);
    const [r1, r2] = [g.roads[0]!, g.roads[1]!];
    expect(r1.flag).toEqual([a, f]);
    expect(r2.flag).toEqual([f, b]);
    expect(r1.length).toBe(3);
    expect(r2.length).toBe(3);
    expect(r1.dirs).toEqual([R, R, R]);
    expect(r2.dirs).toEqual([R, R, R]);
    // every flag points at the right road in the right direction
    expect(g.flags[a]!.road[Dir.Right]).toBe(0);
    expect(g.flags[f]!.road[Dir.Left]).toBe(0);
    expect(g.flags[f]!.road[Dir.Right]).toBe(1);
    expect(g.flags[b]!.road[Dir.Left]).toBe(1);
    // tiles belong to the half they lie on; the flag's own tile is no road
    expect([2, 3].map((x) => g.roadIndexAt(at(g, x, 1)))).toEqual([0, 0]);
    expect([5, 6].map((x) => g.roadIndexAt(at(g, x, 1)))).toEqual([1, 1]);
    expect(g.roadIndexAt(at(g, 4, 1))).toBe(-1);
    expect(g.flagAtPos(at(g, 4, 1))).toBe(f);
    expect(g.layoutVersion).toBeGreaterThan(v);
    // level ground: each half takes the time its length says
    expect(r1.ticks).toEqual([3 * STEP_TICKS, 3 * STEP_TICKS]);
    expect(r2.ticks).toEqual([3 * STEP_TICKS, 3 * STEP_TICKS]);
  });

  it('works at a corner', () => {
    const g = new Game(14, 8);
    const a = g.addFlag(1, 1);
    const b = g.addFlag(4, 4);
    g.addRoad(a, [R, R, R, Dir.Down, Dir.Down, Dir.Down]); // turns at (4,1)
    const f = g.addFlag(4, 1);
    expect(g.roads[0]!.dirs).toEqual([R, R, R]);
    expect(g.roads[1]!.dirs).toEqual([Dir.Down, Dir.Down, Dir.Down]);
    expect(g.flags[f]!.road[Dir.Left]).toBe(0);
    expect(g.flags[f]!.road[Dir.Down]).toBe(1);
    expect(g.flags[b]!.road[Dir.Up]).toBe(1);
  });

  it('keeps the walking time over slopes, each way, split exactly in two', () => {
    const g = new Game(14, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 14; x++) g.terrain.setHeight(g.index(x, y), 8 + x);
    const a = g.addFlag(1, 1);
    g.addFlag(7, 1);
    const whole = g.roads[g.addRoad(a, new Array<Dir>(6).fill(R))]!.ticks.slice();
    g.addFlag(4, 1);
    expect(g.roads[0]!.ticks[0]! + g.roads[1]!.ticks[0]!).toBe(whole[0]);
    expect(g.roads[0]!.ticks[1]! + g.roads[1]!.ticks[1]!).toBe(whole[1]);
    expect(g.roads[0]!.ticks[0]).toBe(3 * stepTicks(1));
  });

  it('keeps flags two steps apart: not next to an existing flag', () => {
    const g = new Game(14, 8);
    const a = g.addFlag(1, 1);
    g.addFlag(7, 1);
    g.addRoad(a, new Array<Dir>(6).fill(R));
    expect(checkFlagAt(g, 2, 1).reason).toBe('too close to another flag');
    expect(() => g.addFlag(2, 1)).toThrow('too close');
    expect(g.roads.length).toBe(1); // nothing changed
    expect(checkFlagAt(g, 3, 1).ok).toBe(true);
    expect(() => g.addFlag(3, 1)).not.toThrow();
  });

  it('can be repeated: a long road becomes a chain of short ones', () => {
    const g = new Game(20, 6);
    const a = g.addFlag(1, 2);
    g.addFlag(13, 2);
    g.addRoad(a, new Array<Dir>(12).fill(R));
    for (const x of [3, 5, 7, 9, 11]) g.addFlag(x, 2);
    expect(g.roads.length).toBe(6);
    expect(g.roads.map((r) => r.length)).toEqual([2, 2, 2, 2, 2, 2]);
    for (const r of g.roads) expect(r.carriers.length).toBe(0);
    // every road is on exactly one pair of flags, in order
    expect(g.roads.every((r) => g.flags[r.flag[0]]!.road[r.dirAt[0]] === r.index && g.flags[r.flag[1]]!.road[r.dirAt[1]] === r.index)).toBe(true);
  });

  it('a building door on a road tile splits it too', () => {
    const g = new Game(14, 8);
    const a = g.addFlag(1, 3);
    g.addFlag(9, 3);
    g.addRoad(a, new Array<Dir>(8).fill(R));
    g.placeBuilding(BuildingType.Lumberjack, at(g, 4, 2), true); // its door is (5,3), on the road
    expect(g.roads.length).toBe(2);
    expect(g.flagAtPos(at(g, 5, 3))).toBeGreaterThanOrEqual(0);
  });

  it('makes a fixed-crew road hire from then on', () => {
    const g = new Game(14, 8);
    const a = g.addFlag(1, 1);
    g.addFlag(7, 1);
    g.addRoad(a, new Array<Dir>(6).fill(R), 2);
    g.addFlag(4, 1);
    expect(g.roads.every((r) => r.dynamic)).toBe(true);
    expect(g.roads[0]!.carriers.length + g.roads[1]!.carriers.length).toBe(2); // nobody is lost
  });
});

describe('forking', () => {
  it('lets a branch start from the new flag and carry goods to the main road', () => {
    const g = new Game(16, 10);
    const west = g.addFlag(1, 3);
    const storageFlag = g.addFlag(9, 3);
    g.addRoad(west, new Array<Dir>(8).fill(R));
    g.addBuilding(BuildingType.Storage, storageFlag);
    const mid = g.addFlag(5, 3); // splits the long road
    const q = g.addFlag(5, 7);
    const path = planRoad(g, mid, g.flags[q]!.pos);
    expect(path).not.toBeNull();
    g.addRoad(mid, path!);
    g.addBuilding(BuildingType.Lumberjack, q); // up on the branch, nothing else around it
    sc.run(g, 6000, (gg, i) => {
      if (i % 50 === 0) checkConservation(gg);
    });
    expect(g.created[Res.Lumber]).toBeGreaterThan(5);
    expect(g.buildings[0]!.stock[Res.Lumber]).toBeGreaterThan(0); // reached the storage via the fork
    checkCarrierBookkeeping(g);
  });
});

describe('carriers across a split', () => {
  /** A single fixed carrier hauling lumber east along one 8-tile road. */
  function haul(): { g: Game; carrier: number } {
    const g = new Game(16, 4);
    const f = sc.row(g, 1, 9, 1, 8, 1);
    g.addBuilding(BuildingType.Lumberjack, f[0]!);
    g.addBuilding(BuildingType.Storage, f[1]!);
    return { g, carrier: 0 };
  }
  /** Steps along the road from its first flag (fractional) of a walking carrier. */
  function position(g: Game, ti: number): number {
    const t = g.transporters[ti]!;
    const road = g.roads[t.road]!;
    const p = Math.min(1, Math.max(0, 1 - t.counter / road.ticks[t.at]!));
    return t.at === 0 ? p * road.length : (1 - p) * road.length;
  }
  function untilCarrying(g: Game, ti: number, lo: number, hi: number): void {
    for (let i = 0; i < 4000; i++) {
      g.update();
      const t = g.transporters[ti]!;
      if (t.state === TState.Walking && t.item.type !== Res.None && t.at === 0) {
        const s = position(g, ti);
        if (s >= lo && s <= hi) return;
      }
    }
    throw new Error('never saw the carrier at that point');
  }

  it('stays with the first half when it is still on it, and drops its item at the new flag', () => {
    const { g, carrier } = haul();
    untilCarrying(g, carrier, 3, 3.6); // heading east, between 3 and 3.6 steps along
    const lumberBefore = g.countItems(Res.Lumber);
    const s = position(g, carrier); // steps along, before the cut
    g.addFlag(6, 1); // 5 steps from the start: the carrier has not reached it
    const t = g.transporters[carrier]!;
    expect(t.road).toBe(0); // first half keeps the old index
    expect(t.at).toBe(0);
    expect(t.state).toBe(TState.Walking);
    expect(t.item.type).toBe(Res.Lumber); // still carrying
    // time left to the new flag: the rest of the first half's walking time
    expect(t.counter).toBe(Math.round(g.roads[0]!.ticks[0]! * (1 - s / 5)));
    expect(g.countItems(Res.Lumber)).toBe(lumberBefore);
    checkCarrierBookkeeping(g);
    sc.run(g, 3000, (gg, i) => {
      if (i % 20 === 0) checkConservation(gg);
    });
    expect(g.buildings[1]!.stock[Res.Lumber]).toBeGreaterThan(0); // everything still arrives
  });

  it('moves to the second half when it is already past the new flag', () => {
    const { g, carrier } = haul();
    untilCarrying(g, carrier, 5, 5.6); // heading east, well past step 3
    const s = position(g, carrier);
    g.addFlag(4, 1); // 3 steps from the start: already behind the carrier
    const t = g.transporters[carrier]!;
    expect(t.road).toBe(1); // the new second half
    expect(t.at).toBe(0); // walking from the new flag's end towards the far flag
    expect(t.item.type).toBe(Res.Lumber);
    expect(g.roads[1]!.carriers).toContain(carrier);
    expect(g.roads[0]!.carriers).not.toContain(carrier);
    // time left to the far flag: the rest of the second half's walking time
    expect(t.counter).toBe(Math.round(g.roads[1]!.ticks[0]! * (1 - (s - 3) / 5)));
    checkCarrierBookkeeping(g);
    sc.run(g, 3000, (gg, i) => {
      if (i % 20 === 0) checkConservation(gg);
    });
    expect(g.buildings[1]!.stock[Res.Lumber]).toBeGreaterThan(0);
  });

  it('leaves a waiting carrier with the half that holds its flag', () => {
    const g = new Game(16, 4);
    const f = sc.row(g, 1, 9, 1, 8, 2); // two carriers, one at each end
    g.addFlag(5, 1);
    const ends = g.transporters.map((t) => t.road);
    expect(new Set(ends)).toEqual(new Set([0, 1]));
    expect(g.transporters[0]!.at).toBe(0); // started at the first flag
    expect(g.transporters[1]!.at).toBe(1); // started at the far flag
    expect(g.transporters[0]!.road).toBe(0);
    expect(g.transporters[1]!.road).toBe(1);
    void f;
  });

  it('keeps a carrier that is still on its way from a storage', () => {
    const g = new Game(16, 4);
    const f = sc.row(g, 1, 9, 1, 8); // dynamic: carriers are hired
    g.addBuilding(BuildingType.Lumberjack, f[0]!);
    g.addBuilding(BuildingType.Storage, f[1]!);
    g.update();
    expect(g.transporters[0]!.state).toBe(TState.Arriving);
    const end = g.transporters[0]!.at;
    g.addFlag(5, 1);
    const t = g.transporters[0]!;
    expect(t.state).toBe(TState.Arriving); // untouched: it is walking to a flag, not along the road
    expect(t.road).toBe(end === 0 ? 0 : 1);
    checkCarrierBookkeeping(g);
  });
});

describe('splitting under load', () => {
  it('never loses an item, however often the roads are cut', () => {
    const g = new Game(26, 8);
    const f = sc.row(g, 1, 25, 3, 12); // roads 12 long, flags at x = 1, 13, 25
    g.addBuilding(BuildingType.Lumberjack, f[0]!);
    g.addBuilding(BuildingType.Lumberjack, f[1]!);
    g.addBuilding(BuildingType.Sawmill, f[1]! === f[0]! ? f[0]! : f[2]!);
    // cut roads at several moments, always in the middle of the longest road
    const cuts = new Set([150, 400, 700, 1100, 1600, 2300, 3200]);
    const lengths: number[] = [];
    sc.run(g, 6000, (gg, i) => {
      if (cuts.has(i)) {
        const longest = gg.roads.reduce((m, r) => (r.length > m.length ? r : m), gg.roads[0]!);
        if (longest.length >= 4) {
          let p = gg.flags[longest.flag[0]]!.pos;
          for (let s = 0; s < Math.floor(longest.length / 2); s++) p = gg.move(p, longest.dirs[s]!);
          if (checkFlagAt(gg, p % gg.cols, Math.floor(p / gg.cols)).ok) {
            gg.addFlag(p % gg.cols, Math.floor(p / gg.cols));
            lengths.push(gg.roads.length);
          }
        }
      }
      if (i % 25 === 0) {
        checkConservation(gg);
        checkCarrierBookkeeping(gg);
      }
    });
    expect(lengths.length).toBeGreaterThanOrEqual(5); // it really did cut several times
    checkConservation(g);
    checkCarrierBookkeeping(g);
    expect(g.created[Res.Lumber]).toBeGreaterThan(10);
  });

  it('is what makes a long road fast: cutting it multiplies throughput', () => {
    const baseline = sc.lumberMade(8, 1).lumber_made; // one carrier on each 8-tile road
    const g = new Game(20, 4);
    const f = sc.row(g, 1, 17, 1, 8, 1);
    g.addBuilding(BuildingType.Lumberjack, f[0]!);
    g.addBuilding(BuildingType.Storage, f[f.length - 1]!);
    for (const x of [5, 13]) g.addFlag(x, 1); // cut each road in the middle
    sc.run(g, 15000, (gg, i) => {
      if (i % 100 === 0) checkConservation(gg);
    });
    expect(baseline).toBe(32);
    expect(g.created[Res.Lumber]).toBeGreaterThan(baseline * 1.5);
  });
});
