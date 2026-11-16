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
    g.addStock(c.castle, Res.Sword, 10);
    g.addStock(c.castle, Res.Shield, 10);
    const hut = g.addBuilding(T.Hut, c.f[0]!);
    run(g, 6000);
    expect(g.buildings[hut]!.garrison).toBe(3);
    expect(g.knights.length).toBe(0);
    expect(g.buildings[c.castle]!.stock[Res.Sword]).toBe(7);
    expect(g.buildings[c.castle]!.stock[Res.Shield]).toBe(7);
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
