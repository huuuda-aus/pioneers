// Garrisons: a Hut/Tower/Fortress wants knights, armed with a sword and a
// shield from the nearest storage; a Weaponsmith makes both, roughly evenly.
import { describe, expect, it } from 'vitest';
import { BuildingType, Game, Res } from '../src/index.ts';
import { CastleColony, run } from './scenarios.ts';

const T = BuildingType;

/** Through real JSON, as a browser would store it. */
const roundtrip = (g: Game): Game => Game.restore(JSON.parse(JSON.stringify(g.serialize())));

describe('a hut', () => {
  it('fills to capacity given enough swords and shields, and stops asking', () => {
    const c = new CastleColony();
    const g = c.g;
    g.addStock(c.castle, Res.Sword, 20);
    g.addStock(c.castle, Res.Shield, 20);
    const hut = g.addBuilding(T.Hut, c.f[0]!);
    run(g, 6000);
    expect(g.buildings[hut]!.garrison).toBe(3);
    expect(g.knights.length).toBe(0);
    expect(g.buildings[c.castle]!.garrison).toBe(6); // the castle armed its own six
    expect(g.buildings[c.castle]!.stock[Res.Sword]).toBe(11); // 20 less 3 for the hut and 6 for the castle
    expect(g.buildings[c.castle]!.stock[Res.Shield]).toBe(11);
  });

  it('stays empty without a sword and a shield to arm one', () => {
    const c = new CastleColony();
    const g = c.g;
    const hut = g.addBuilding(T.Hut, c.f[0]!);
    run(g, 6000);
    expect(g.buildings[hut]!.garrison).toBe(0);
    expect(g.knights.length).toBe(0);
  });

  it('a knight lost to a demolished destination does not crash or garrison anything', () => {
    const c = new CastleColony();
    const g = c.g;
    g.addStock(c.castle, Res.Sword, 1);
    g.addStock(c.castle, Res.Shield, 1);
    const hut = g.addBuilding(T.Hut, c.f[0]!);
    run(g, 1); // a tick: the knight is hired and on his way
    expect(g.knights.length).toBe(1);
    g.demolishBuilding(hut);
    expect(() => run(g, 6000)).not.toThrow();
    expect(g.knights.length).toBe(0);
    expect(g.buildings[hut]!.garrison).toBe(0);
  });
});

describe('a weaponsmith', () => {
  it('makes swords and shields in roughly equal numbers', () => {
    const c = new CastleColony();
    const g = c.g;
    g.addStock(c.castle, Res.Coal, 40);
    g.addStock(c.castle, Res.Iron, 40);
    const smith = g.addBuilding(T.Weaponsmith, c.f[0]!);
    run(g, 20000);
    expect(g.created[Res.Sword]!).toBeGreaterThan(5);
    expect(Math.abs(g.created[Res.Sword]! - g.created[Res.Shield]!)).toBeLessThanOrEqual(1);
    expect(g.buildings[smith]!.constructing).toBe(false);
  });
});

describe('the castle\'s own garrison', () => {
  it('fills to six from its own stock and stops without swords, using no gold on promotions', () => {
    const c = new CastleColony();
    const g = c.g;
    const castle = g.buildings[c.castle]!;
    g.addStock(c.castle, Res.Sword, 4);
    g.addStock(c.castle, Res.Shield, 4);
    g.addStock(c.castle, Res.Gold, 3);
    run(g, 20000);
    expect(castle.garrison).toBe(4);
    expect(castle.stock[Res.Sword]).toBe(0);
    g.addStock(c.castle, Res.Sword, 9);
    g.addStock(c.castle, Res.Shield, 9);
    run(g, 20000);
    expect(castle.garrison).toBe(6);
    expect(castle.stock[Res.Gold]).toBe(3);
  });

  it('does not count as one of the garrison buildings the soft cap limits', () => {
    const g = new Game(40, 20);
    g.placeBuilding(T.Castle, g.index(10, 10), false, 0);
    expect(g.garrisonBuildingsOf(0)).toBe(0);
  });
});

describe('training', () => {
  it('spends gold to promote the lowest-ranked knight, one step per period', () => {
    const c = new CastleColony();
    const g = c.g;
    const hut = g.addBuilding(T.Hut, c.f[0]!);
    const b = g.buildings[hut]!;
    b.garrison = 3;
    g.addStock(hut, Res.Gold, 2);
    run(g, 40);
    expect(b.stock[Res.Gold]).toBe(1);
    expect(g.knightRanks(b)).toEqual([2, 1, 0, 0, 0]);
    run(g, 1000); // the next period
    expect(b.stock[Res.Gold]).toBe(0);
    expect(g.knightRanks(b)).toEqual([1, 2, 0, 0, 0]); // the lowest first
    expect(g.consumed[Res.Gold]).toBe(2);
  });

  it('never promotes beyond rank 4, and keeps its gold when there is nobody to promote', () => {
    const c = new CastleColony();
    const g = c.g;
    const hut = g.addBuilding(T.Hut, c.f[0]!);
    const b = g.buildings[hut]!;
    b.garrison = 1;
    b.veterans = [0, 0, 0, 1];
    g.addStock(hut, Res.Gold, 2);
    run(g, 4000);
    expect(g.knightRanks(b)).toEqual([0, 0, 0, 0, 1]);
    expect(b.stock[Res.Gold]).toBe(2); // nobody left to promote: the gold stays
  });

  it('asks for gold through the normal logistics, up to its capacity', () => {
    const c = new CastleColony();
    const g = c.g;
    g.addStock(c.castle, Res.Gold, 10);
    const hut = g.addBuilding(T.Hut, c.f[0]!);
    run(g, 6000);
    expect(g.buildings[hut]!.stock[Res.Gold]! + g.buildings[hut]!.requested[Res.Gold]!).toBeLessThanOrEqual(2);
    expect(g.buildings[hut]!.stock[Res.Gold]).toBe(2);
  });

  it('without gold, promotion by time is slow, deterministic, and saved exactly', () => {
    const make = () => {
      const c = new CastleColony();
      const hut = c.g.addBuilding(T.Hut, c.f[0]!);
      c.g.buildings[hut]!.garrison = 3;
      return { g: c.g, hut };
    };
    const a = make();
    run(a.g, 120000);
    const b = make();
    run(b.g, 60000);
    const copy = roundtrip(b.g);
    run(b.g, 60000);
    run(copy, 60000);
    expect(JSON.stringify(b.g.serialize())).toBe(JSON.stringify(a.g.serialize()));
    expect(JSON.stringify(copy.serialize())).toBe(JSON.stringify(a.g.serialize()));
    expect(a.g.buildings[a.hut]!.veterans.reduce((n, v) => n + v, 0)).toBeGreaterThan(0);
  });
});

describe('save and load', () => {
  it('a round trip keeps garrison counts and every knight on the road', () => {
    const c = new CastleColony();
    const g = c.g;
    g.addStock(c.castle, Res.Sword, 10);
    g.addStock(c.castle, Res.Shield, 10);
    const hut = g.addBuilding(T.Hut, c.f[0]!);
    run(g, 50); // a knight hired, still walking
    expect(g.knights.length).toBeGreaterThan(0);

    const h = roundtrip(g);
    expect(h.knights).toEqual(g.knights);
    expect(h.buildings[hut]!.garrison).toBe(g.buildings[hut]!.garrison);
    run(h, 6000);
    expect(h.buildings[hut]!.garrison).toBe(3);
  });

  it('an old save with no knights/garrison fields loads clean', () => {
    const c = new CastleColony();
    const g = c.g;
    g.addBuilding(T.Hut, c.f[0]!);
    const data = g.serialize() as unknown as { buildings: unknown[] } & Record<string, unknown>;
    delete data.knights;
    delete data.nextKnight;
    for (const b of data.buildings) delete (b as { garrison?: number }).garrison;
    const h = Game.restore(JSON.parse(JSON.stringify(data)) as Parameters<typeof Game.restore>[0]);
    expect(h.knights).toEqual([]);
    expect(h.buildings.every((b) => b.garrison === 0)).toBe(true);
  });
});
