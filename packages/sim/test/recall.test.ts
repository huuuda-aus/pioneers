// Spare carriers: a busy road hires more, and when the rush is over the extras
// walk back to a storage.
import { describe, expect, it } from 'vitest';
import { BuildingType, Dir, Game, IDLE_RELEASE } from '../src/index.ts';

const T = BuildingType;

/** A castle, a short road, then a long road to a lumberjack at the far end that outpaces one carrier. */
function rush(settlers: boolean) {
  const g = new Game(32, 6);
  g.settlers = settlers;
  const a = g.addFlag(2, 3);
  const c = g.addFlag(4, 3);
  const b = g.addFlag(16, 3);
  const castle = g.buildings[g.addBuilding(T.Castle, a)]!;
  g.addRoad(a, [Dir.Right, Dir.Right]);
  const road = g.roads[g.addRoad(c, new Array<Dir>(12).fill(Dir.Right))]!;
  const hut = g.addBuilding(T.Lumberjack, b);
  g.buildings[hut]!.period = 20;
  return { g, castle, road, hut };
}

const onRoads = (g: Game) => g.roads.reduce((n, r) => n + r.carriers.length, 0);

const run = (g: Game, n: number) => {
  for (let i = 0; i < n; i++) g.update();
};

describe('spare carriers', () => {
  it('a busy road gets extra carriers', () => {
    const { g, road } = rush(true);
    run(g, 2500);
    expect(road.carriers.length).toBeGreaterThan(1);
  });

  it('once the rush is over the extras go back to the castle, one stays', () => {
    const { g, castle, road, hut } = rush(true);
    run(g, 2500);
    const peak = road.carriers.length;
    const out = castle.carriers;
    g.demolishBuilding(hut);
    run(g, 3000); // fire out, flags drained
    run(g, IDLE_RELEASE / g.speed + 1500); // idle long enough, walk back
    expect(peak).toBeGreaterThan(1);
    expect(road.carriers.length).toBe(1);
    expect(castle.carriers).toBe(out + peak - 1);
  });

  it('they leave only after standing idle a good while, and take time to walk back', () => {
    const { g, castle, hut } = rush(true);
    run(g, 2500);
    g.demolishBuilding(hut);
    const crew = () => 40 - castle.carriers; // out on roads or walking
    let steps = 0;
    while (crew() === onRoads(g) && steps++ < 30000) g.update();
    expect(crew()).toBeGreaterThan(onRoads(g)); // someone is on the way home
    const sent = g.transporters.filter((t) => t.gone);
    expect(sent.length).toBeGreaterThan(0);
    for (const t of sent) expect(t.idle).toBeGreaterThanOrEqual(IDLE_RELEASE); // stood that long first
  });

  it('the crew balances: at home plus on the road is always the whole crew', () => {
    const { g, castle, hut } = rush(true);
    run(g, 2500);
    g.demolishBuilding(hut);
    run(g, 12000);
    expect(castle.carriers + onRoads(g)).toBe(40);
  });

  it('they can be hired again by the next rush', () => {
    const { g, road, hut } = rush(true);
    run(g, 2500);
    g.demolishBuilding(hut);
    run(g, 12000);
    expect(road.carriers.length).toBe(1);
    const again = g.addBuilding(T.Lumberjack, road.flag[1]!);
    g.buildings[again]!.period = 20;
    run(g, 3000);
    expect(road.carriers.length).toBeGreaterThan(1);
  });

  it('off: nobody is sent home (the C++ reference never does)', () => {
    const { g, road, hut } = rush(false);
    run(g, 2500);
    g.demolishBuilding(hut);
    run(g, 3000); // flags drained, no more hiring
    const peak = road.carriers.length;
    run(g, 12000);
    expect(peak).toBeGreaterThan(1);
    expect(road.carriers.length).toBe(peak);
  });

  it('a road keeps its last carrier even if idle for ever', () => {
    const { g, road, hut } = rush(true);
    run(g, 100);
    g.demolishBuilding(hut);
    let least = 99;
    for (let i = 0; i < 20000; i++) {
      g.update();
      least = Math.min(least, road.carriers.length);
    }
    expect(least).toBe(1);
    expect(road.carriers.length).toBe(1);
  });

  it('a save made with carriers walking home carries on identically', () => {
    const { g, hut } = rush(true);
    run(g, 2500);
    g.demolishBuilding(hut);
    // find a moment with someone out of the crew and not yet on a road
    const castle = g.buildings[0]!;
    let steps = 0;
    while (40 - castle.carriers === onRoads(g) && steps++ < 30000) g.update();
    expect(40 - castle.carriers).toBeGreaterThan(onRoads(g));
    const copy = Game.restore(JSON.parse(JSON.stringify(g.serialize())));
    run(g, 3000);
    run(copy, 3000);
    expect(copy.fingerprint()).toBe(g.fingerprint());
    expect(copy.buildings[0]!.carriers).toBe(g.buildings[0]!.carriers);
  });

  it('a carrier on his way home can be drawn: where from, how long, how far along', () => {
    const { g, castle, hut } = rush(true);
    run(g, 2500);
    g.demolishBuilding(hut);
    let steps = 0;
    while (g.homebound.length === 0 && steps++ < 30000) g.update();
    expect(g.homebound.length).toBeGreaterThan(0);
    const [storage, left, from, total] = g.homebound[0]!;
    expect(storage).toBe(castle.index);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(g.flags[from]!.removed).toBe(false);
    expect(total).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(total);
    const route = g.walkRoute(from, castle.flag)!;
    expect(route[0]).toBe(from);
    expect(route[route.length - 1]).toBe(castle.flag);
    const before = left;
    run(g, 20);
    const now = g.homebound.find((h) => h[2] === from && h[3] === total);
    if (now) expect(now[1]).toBeLessThan(before); // he is getting closer
  });

  it('an old save without the drawing data still brings him home', () => {
    const { g, castle, hut } = rush(true);
    run(g, 2500);
    g.demolishBuilding(hut);
    let steps = 0;
    while (g.homebound.length === 0 && steps++ < 30000) g.update();
    const d = JSON.parse(JSON.stringify(g.serialize()));
    d.homebound = d.homebound.map((h: number[]) => [h[0], h[1]]);
    const old = Game.restore(d);
    expect(old.homebound[0]![2]).toBe(-1);
    const out = castle.carriers;
    run(old, 3000);
    expect(old.homebound.length).toBe(0);
    expect(old.buildings[0]!.carriers).toBeGreaterThan(out);
  });
});
