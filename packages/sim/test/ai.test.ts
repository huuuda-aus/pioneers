// The computer opponent: it plays by the rules the player does, so these
// check what it builds and does, and that a saved game replays it exactly.
import { describe, expect, it } from 'vitest';
import { BuildingType, Game, Res, Temperament } from '../src/index.ts';
import { run } from './scenarios.ts';

const T = BuildingType;

/** Through real JSON, as a browser would store it. */
const roundtrip = (g: Game): Game => Game.restore(JSON.parse(JSON.stringify(g.serialize())));

/** Owner 0 (nobody plays it) in the west, owner 1 (the AI) in the east, both stocked to build and arm. */
function world(temperament: Temperament, gap = 36) {
  const g = new Game(120, 60);
  const west = g.placeBuilding(T.Castle, g.index(20, 30), false, 0);
  const east = g.placeBuilding(T.Castle, g.index(20 + gap, 30), false, 1);
  for (const c of [west, east]) {
    g.addStock(c, Res.Plank, 60);
    g.addStock(c, Res.Stone, 30);
    g.addStock(c, Res.Sword, 20);
    g.addStock(c, Res.Shield, 20);
  }
  const ai = g.addAi(1, temperament);
  return { g, ai, west, east };
}

const countOf = (g: Game, owner: number, type: BuildingType): number =>
  g.buildings.filter((b) => !b.removed && b.owner === owner && b.type === type).length;

describe('building up from the castle', () => {
  it('puts up wood, stone and then military buildings, all joined to its castle', () => {
    const { g, east } = world(Temperament.Defensive);
    run(g, 60000);
    expect(countOf(g, 1, T.Lumberjack)).toBe(2);
    expect(countOf(g, 1, T.Sawmill)).toBe(1);
    expect(countOf(g, 1, T.Stonecutter)).toBe(1);
    expect(countOf(g, 1, T.Forester)).toBe(1);
    const military = g.buildings.filter((b) => !b.removed && b.owner === 1 && (b.type === T.Hut || b.type === T.Tower));
    expect(military.length).toBeGreaterThan(1);
    // everything it owns hangs off its castle by road
    const reach = new Set<number>([g.buildings[east]!.flag]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of g.roads) {
        if (r.removed) continue;
        if (reach.has(r.flag[0]) !== reach.has(r.flag[1])) {
          reach.add(r.flag[0]);
          reach.add(r.flag[1]);
          grew = true;
        }
      }
    }
    for (const b of g.buildings) if (!b.removed && b.owner === 1 && b.burning === 0) expect(reach.has(b.flag), `${T[b.type]} is connected`).toBe(true);
  });

  it('grows the land it holds as it expands', () => {
    const { g } = world(Temperament.Defensive);
    const land = () => g.ownerAt.filter((o) => o === 1).length;
    const before = land();
    run(g, 60000);
    expect(land()).toBeGreaterThan(before * 1.5);
  });

  it('its knights are armed from the castle and garrison what it built', () => {
    const { g } = world(Temperament.Defensive);
    run(g, 60000);
    const huts = g.buildings.filter((b) => !b.removed && b.owner === 1 && b.type === T.Hut);
    expect(huts.some((h) => h.garrison > 0)).toBe(true);
  });

  it('does not touch the other side', () => {
    const { g } = world(Temperament.Defensive);
    run(g, 60000);
    expect(g.buildings.filter((b) => b.owner === 0 && !b.removed).length).toBe(1); // just the castle
  });
});

describe('temperament', () => {
  /** An owner 0 hut with `knights` inside right in the AI's reach, so there is something to attack. */
  function withTarget(temperament: Temperament, knights: number) {
    const w = world(temperament, 36);
    const flag = w.g.addFlag(40, 30, 0);
    const hut = w.g.addBuilding(T.Hut, flag);
    w.g.setGarrison(hut, knights);
    return { ...w, hut };
  }

  it('peaceful never attacks, however weak the target', () => {
    const { g, hut } = withTarget(Temperament.Peaceful, 1);
    let attacked = false;
    for (let i = 0; i < 80000; i++) {
      g.update();
      if (g.attackers.length > 0 || g.buildings[hut]!.owner !== 0) attacked = true;
    }
    expect(attacked).toBe(false);
  });

  it('aggressive attacks a weak target once it can spare enough knights', () => {
    const { g, hut } = withTarget(Temperament.Aggressive, 1);
    let attacked = false;
    for (let i = 0; i < 80000 && !attacked; i++) {
      g.update();
      if (g.attackers.some((a) => a.owner === 1)) attacked = true;
    }
    expect(attacked).toBe(true);
    expect(hut).toBeGreaterThanOrEqual(0);
  });

  it('defensive leaves a neighbour alone until it is attacked, then hits back', () => {
    const { g, hut, ai } = withTarget(Temperament.Defensive, 1);
    for (let i = 0; i < 60000; i++) g.update();
    expect(g.attackers.some((a) => a.owner === 1)).toBe(false);
    expect(ai.provoked).toBe(-1);
    // the neighbour strikes first
    g.setGarrison(hut, 3);
    const theirs = g.buildings.find((b) => !b.removed && b.owner === 1 && b.type === T.Hut && b.garrison > 1)!;
    g.sendAttack(0, theirs.index, 1);
    expect(ai.provoked).toBeGreaterThanOrEqual(0);
    let struck = false;
    for (let i = 0; i < 60000 && !struck; i++) {
      g.update();
      if (g.attackers.some((a) => a.owner === 1)) struck = true;
    }
    expect(struck).toBe(true);
  });
});

describe('save and load', () => {
  it('is exact: a round trip mid-game carries on the same, and two runs agree', () => {
    const a = world(Temperament.Aggressive).g;
    run(a, 30000);
    const b = roundtrip(a);
    run(a, 30000);
    run(b, 30000);
    expect(JSON.stringify(b.serialize())).toBe(JSON.stringify(a.serialize()));
    const c = world(Temperament.Aggressive).g;
    run(c, 60000);
    expect(JSON.stringify(c.serialize())).toBe(JSON.stringify(a.serialize()));
  });

  it('an old save with no ais loads, without an opponent', () => {
    const { g } = world(Temperament.Defensive);
    const data = g.serialize() as unknown as Record<string, unknown>;
    delete data.ais;
    const h = Game.restore(JSON.parse(JSON.stringify(data)) as Parameters<typeof Game.restore>[0]);
    expect(h.ais).toEqual([]);
  });
});
