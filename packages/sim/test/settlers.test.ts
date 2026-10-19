// A finished building is empty until its worker has walked over from a storage.
import { describe, expect, it } from 'vitest';
import { BState, BuildingType, Dir, Game, Res } from '../src/index.ts';

const T = BuildingType;

/** Castle at one end of a road `len` steps long, a finished-on-arrival lumber hut at the other. */
function colony(settlers: boolean, len = 6) {
  const g = new Game(24, 6);
  g.settlers = settlers;
  const a = g.addFlag(2, 3);
  const b = g.addFlag(2 + len, 3);
  g.addBuilding(T.Castle, a);
  g.addRoad(a, new Array<Dir>(len).fill(Dir.Right));
  const site = g.buildings[g.addBuilding(T.Lumberjack, b, true)]!;
  for (let r = 0; r < site.need.length; r++) site.stock[r] = site.need[r]!; // materials already here
  return { g, a, b, site };
}

function untilBuilt(g: Game, site: { constructing: boolean }): void {
  for (let i = 0; i < 5000 && site.constructing; i++) g.update();
  expect(site.constructing).toBe(false);
}

describe('workers walk in', () => {
  it('off: the building starts at once, as in the C++ reference', () => {
    const { g, site } = colony(false);
    untilBuilt(g, site);
    expect(site.state).toBe(BState.Idle);
  });

  it('on: the building waits for its worker, who takes a road-length walk', () => {
    const { g, site } = colony(true);
    untilBuilt(g, site);
    expect(site.state).toBe(BState.Arriving);
    let steps = 0;
    while (site.state === BState.Arriving && steps < 5000) {
      g.update();
      steps++;
    }
    expect(site.state).not.toBe(BState.Arriving);
    // six road steps at 80 ticks, two ticks per step at the default speed
    expect(steps * g.speed).toBeGreaterThanOrEqual(6 * 80 - 2 * g.speed);
    expect(steps * g.speed).toBeLessThan(6 * 80 + 4 * g.speed);
  });

  it('a farther building waits longer', () => {
    const wait = (len: number) => {
      const { g, site } = colony(true, len);
      untilBuilt(g, site);
      let n = 0;
      while (site.state === BState.Arriving && n < 5000) {
        g.update();
        n++;
      }
      return n;
    };
    expect(wait(10)).toBeGreaterThan(wait(4));
  });

  it('with no road to a storage he waits, and sets out once there is one', () => {
    const { g, a, site } = colony(true);
    untilBuilt(g, site);
    g.demolishRoad(0);
    for (let i = 0; i < 2000; i++) g.update();
    expect(site.state).toBe(BState.Arriving);
    g.addRoad(a, [Dir.Right, Dir.Right, Dir.Right, Dir.Right, Dir.Right, Dir.Right]);
    for (let i = 0; i < 2000 && site.state === BState.Arriving; i++) g.update();
    expect(site.state).not.toBe(BState.Arriving);
  });

  it('stores need no walk, a burning site does not trip over it', () => {
    const g = new Game(24, 6);
    g.settlers = true;
    const a = g.addFlag(2, 3);
    const b = g.addFlag(8, 3);
    g.addBuilding(T.Castle, a);
    g.addRoad(a, new Array<Dir>(6).fill(Dir.Right));
    const s = g.buildings[g.addBuilding(T.Storage, b, true)]!;
    for (let r = 0; r < s.need.length; r++) s.stock[r] = s.need[r]!;
    untilBuilt(g, s);
    expect(s.state).toBe(BState.Idle);
    g.demolishBuilding(s.index);
    for (let i = 0; i < 2000; i++) g.update();
    expect(s.removed).toBe(true);
  });

  it('a save made while he is walking carries on identically', () => {
    const { g, site } = colony(true);
    untilBuilt(g, site);
    for (let i = 0; i < 100; i++) g.update();
    expect(site.state).toBe(BState.Arriving);
    const copy = Game.restore(JSON.parse(JSON.stringify(g.serialize())));
    for (let i = 0; i < 1500; i++) {
      g.update();
      copy.update();
    }
    expect(copy.fingerprint()).toBe(g.fingerprint());
    expect(copy.buildings[site.index]!.state).toBe(site.state);
    expect(copy.settlers).toBe(true);
  });

  it('an old save without the setting loads with it off', () => {
    const { g } = colony(true);
    const d = JSON.parse(JSON.stringify(g.serialize()));
    delete d.settlers;
    expect(Game.restore(d).settlers).toBe(false);
  });

  it('production only begins after arrival', () => {
    const { g, site } = colony(true);
    site.stock[Res.Lumber] = 0;
    untilBuilt(g, site);
    const made = g.created[Res.Lumber]!;
    for (let i = 0; i < 100 && site.state === BState.Arriving; i++) g.update();
    expect(g.created[Res.Lumber]).toBe(made);
  });

  it('while he walks, the building knows the walk and the route is the road', () => {
    const g = new Game(24, 6);
    g.settlers = true;
    const a = g.addFlag(2, 3);
    const m = g.addFlag(6, 3);
    const b = g.addFlag(10, 3);
    const side = g.addFlag(6, 5);
    g.addBuilding(T.Castle, a);
    g.addRoad(a, [Dir.Right, Dir.Right, Dir.Right, Dir.Right]);
    g.addRoad(m, [Dir.Right, Dir.Right, Dir.Right, Dir.Right]);
    g.addRoad(m, [Dir.Down, Dir.Down]);
    const site = g.buildings[g.addBuilding(T.Lumberjack, b, true)]!;
    for (let r = 0; r < site.need.length; r++) site.stock[r] = site.need[r]!;
    untilBuilt(g, site);
    g.update();
    expect(site.state).toBe(BState.Arriving);
    expect(site.walkTicks).toBeGreaterThan(0);
    expect(site.counter).toBeLessThanOrEqual(site.walkTicks);
    expect(g.walkRoute(a, b)).toEqual([a, m, b]); // not via the side flag
    expect(g.walkRoute(a, side)).toEqual([a, m, side]);
    expect(g.walkRoute(b, b)).toEqual([b]);
    g.demolishRoad(0);
    expect(g.walkRoute(a, b)).toBeNull();
  });
});
