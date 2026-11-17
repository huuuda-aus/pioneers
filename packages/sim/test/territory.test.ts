// Territory: who owns the land around a military building (so far, only the
// castle), and what happens to anything standing where the border moves away.
// Ported from freeserf's update_land_ownership/surrender_land (see DESIGN.md).
import { describe, expect, it } from 'vitest';
import { BuildingType, Dir, Game, Res, UNCLAIMED } from '../src/index.ts';

const T = BuildingType;

/** Through real JSON, as a browser would store it. */
const roundtrip = (g: Game): Game => Game.restore(JSON.parse(JSON.stringify(g.serialize())));

describe('a lone castle', () => {
  it('claims every point up to 8 steps away, and nothing further', () => {
    const g = new Game(40, 40);
    const cx = 20;
    const cy = 20;
    g.placeBuilding(T.Castle, g.index(cx, cy), false);
    expect(g.ownerAt[g.index(cx, cy)]).toBe(0);
    expect(g.ownerAt[g.index(cx + 8, cy)]).toBe(0); // the far edge of its reach
    expect(g.ownerAt[g.index(cx + 9, cy)]).toBe(UNCLAIMED); // one step further: nothing
    expect(g.ownerAt[g.index(cx, cy - 8)]).toBe(0);
    expect(g.ownerAt[g.index(0, 0)]).toBe(UNCLAIMED);
  });

  it('only one castle per owner, but a second owner can place their own', () => {
    const g = new Game(40, 20);
    g.placeBuilding(T.Castle, g.index(10, 10), false, 0);
    expect(() => g.placeBuilding(T.Castle, g.index(15, 10), false, 0)).toThrow(/only one castle/);
    expect(() => g.placeBuilding(T.Castle, g.index(30, 10), false, 1)).not.toThrow();
    expect(g.castleOf(0)).not.toBe(g.castleOf(1));
  });
});

describe('building on someone else\'s land', () => {
  it('is refused, for a building and for a bare flag', () => {
    const g = new Game(40, 20);
    g.placeBuilding(T.Castle, g.index(10, 10), false, 0);
    expect(() => g.placeBuilding(T.Lumberjack, g.index(12, 10), true, 1)).toThrow(/belongs to someone else/);
    expect(() => g.addFlag(12, 10, 1)).toThrow(/belongs to someone else/);
  });

  it('is fine on unclaimed ground, and on your own', () => {
    const g = new Game(40, 20);
    g.placeBuilding(T.Castle, g.index(10, 10), false, 0);
    expect(() => g.placeBuilding(T.Lumberjack, g.index(30, 10), true, 1)).not.toThrow(); // far away: unclaimed
    expect(() => g.placeBuilding(T.Lumberjack, g.index(10, 6), true, 0)).not.toThrow(); // within your own reach
  });
});

describe('recomputing a window', () => {
  it('keeps what another building holds in the corners of the window, which are further than the radius', () => {
    const g = new Game(80, 40);
    g.placeBuilding(T.Castle, g.index(56, 30), false, 1);
    expect(g.ownerAt[g.index(56, 28)]).toBe(1);
    const f = g.addFlag(49, 31, 1);
    const hut = g.addBuilding(T.Hut, f);
    g.setGarrison(hut, 1); // recomputes the 17x17 window round the hut, whose corner takes in (56,28)
    expect(g.ownerAt[g.index(56, 28)]).toBe(1);
  });
});

describe('how many military buildings you may have', () => {
  it('keeps them apart: nothing within 2 steps of another, the castle included', () => {
    const g = new Game(40, 30);
    g.placeBuilding(T.Castle, g.index(10, 14), false, 0);
    g.placeBuilding(T.Hut, g.index(10, 8), false, 0);
    expect(() => g.placeBuilding(T.Hut, g.index(10, 10), false, 0)).toThrow(/too close to another military/);
    expect(() => g.placeBuilding(T.Hut, g.index(11, 9), false, 0)).toThrow(/too close to another military/);
    expect(() => g.placeBuilding(T.Hut, g.index(10, 5), false, 0)).not.toThrow(); // 3 steps from the first
    // not military buildings: workshops may stand right beside one
    expect(() => g.placeBuilding(T.Lumberjack, g.index(14, 9), true, 0)).not.toThrow();
  });

  it('never more than two garrison buildings beyond the knights you actually have', () => {
    const g = new Game(60, 30);
    g.placeBuilding(T.Castle, g.index(30, 15), false, 0);
    const huts = [g.placeBuilding(T.Hut, g.index(30, 9), false, 0), g.placeBuilding(T.Hut, g.index(30, 21), false, 0)];
    expect(() => g.placeBuilding(T.Hut, g.index(24, 15), false, 0)).toThrow(/not enough knights/);
    expect(() => g.placeBuilding(T.Tower, g.index(36, 15), false, 0)).toThrow(/not enough knights/);
    g.setGarrison(huts[0]!, 1);
    expect(g.knightsOf(0)).toBe(1);
    expect(() => g.placeBuilding(T.Hut, g.index(24, 15), false, 0)).not.toThrow();
    expect(() => g.placeBuilding(T.Hut, g.index(36, 15), false, 0)).toThrow(/not enough knights/); // 3 buildings, 1 knight
  });

  it('counts knights on the road and out fighting, and each owner on their own', () => {
    const g = new Game(60, 30);
    g.placeBuilding(T.Castle, g.index(10, 15), false, 0);
    g.placeBuilding(T.Castle, g.index(50, 15), false, 1);
    const h = g.placeBuilding(T.Hut, g.index(10, 8), false, 0);
    g.knights.push({ id: 0, home: 0, building: h, counter: 100, total: 100 });
    expect(g.knightsOf(0)).toBe(1);
    expect(g.knightsOf(1)).toBe(0);
    expect(g.garrisonBuildingsOf(0)).toBe(1);
    expect(g.garrisonBuildingsOf(1)).toBe(0);
  });
});

describe('two castles far apart', () => {
  it("do not reach each other's land", () => {
    const g = new Game(60, 20);
    g.placeBuilding(T.Castle, g.index(10, 10), false, 0);
    g.placeBuilding(T.Castle, g.index(50, 10), false, 1);
    expect(g.ownerAt[g.index(10, 10)]).toBe(0);
    expect(g.ownerAt[g.index(50, 10)]).toBe(1);
    expect(g.ownerAt[g.index(30, 10)]).toBe(UNCLAIMED); // the no man's land between them
  });
});

describe('when the border moves away', () => {
  it('removes a flag now standing on land an enemy castle just claimed', () => {
    const g = new Game(30, 20);
    const flag = g.addFlag(20, 10, 0); // a lone outpost flag, well before any castle reaches it
    expect(g.ownerAt[g.index(20, 10)]).toBe(UNCLAIMED);
    g.placeBuilding(T.Castle, g.index(24, 8), false, 1); // an enemy castle 6 steps away, clear of the flag
    expect(g.ownerAt[g.index(20, 10)]).toBe(1);
    expect(g.flags[flag]!.removed).toBe(true);
  });

  it('removes a road tile the same way, and its carrier is refunded, not left dangling', () => {
    const g = new Game(30, 20);
    const a = g.addFlag(16, 10, 0);
    g.addFlag(20, 10, 0);
    g.addRoad(a, [Dir.Right, Dir.Right, Dir.Right, Dir.Right], 1);
    expect(g.roadIndexAt(g.index(18, 10))).toBeGreaterThanOrEqual(0);
    g.placeBuilding(T.Castle, g.index(18, 5), false, 1); // an enemy castle 5 steps north, clear of the road
    expect(g.roadIndexAt(g.index(18, 10))).toBe(-1);
    expect(g.roads[0]!.removed).toBe(true);
  });

  it("leaves both castles standing even where their territories meet", () => {
    const g = new Game(30, 20);
    const f1 = g.addFlag(17, 11, 1); // placed before anyone's territory exists, so this is unclaimed ground
    g.placeBuilding(T.Castle, g.index(10, 10), false, 0);
    g.addBuilding(T.Castle, f1); // addBuilding skips placement checks: close enough that the border now runs between them
    expect(g.buildings[g.castleOf(0)]!.removed).toBe(false);
    expect(g.buildings[g.castleOf(1)]!.removed).toBe(false);
  });
});

describe('a hut', () => {
  it('defends nothing until a knight actually garrisons it, then loses a head-to-head contest with a castle', () => {
    const g = new Game(30, 30);
    g.placeBuilding(T.Castle, g.index(10, 10), false, 0);
    // owner 1's own little economy, far enough south that it never touches the castle's
    const f1 = g.addFlag(10, 22, 1);
    const storage = g.addBuilding(T.Storage, f1, false);
    g.addStock(storage, Res.Sword, 5);
    g.addStock(storage, Res.Shield, 5);
    const f2 = g.addFlag(12, 22, 1);
    g.addRoad(f1, [Dir.Right, Dir.Right]);
    const hut = g.addBuilding(T.Hut, f2, false);
    const hb = g.buildings[hut]!.pos;

    expect(g.ownerAt[hb]).toBe(UNCLAIMED); // empty: defends nothing yet
    for (let i = 0; i < 3000 && g.buildings[hut]!.garrison === 0; i++) g.update();
    expect(g.buildings[hut]!.garrison).toBeGreaterThan(0);
    expect(g.ownerAt[hb]).toBe(1); // its first knight arrived: now it claims its own point
    const midRow = Math.floor((10 + Math.floor(hb / g.cols)) / 2);
    expect(g.ownerAt[g.index(10, midRow)]).toBe(0); // equidistant from both: the castle is far stronger

    g.demolishBuilding(hut);
    expect(g.ownerAt[hb]).toBe(UNCLAIMED); // a burning hut defends nothing
  });
});

describe('save and load', () => {
  it('a round trip keeps every owner tag and recomputes the same territory', () => {
    const g = new Game(60, 20);
    g.placeBuilding(T.Castle, g.index(10, 10), false, 0);
    g.placeBuilding(T.Castle, g.index(50, 10), false, 1);
    const flag = g.addFlag(30, 10, 0);

    const h = roundtrip(g);
    expect(Array.from(h.ownerAt)).toEqual(Array.from(g.ownerAt));
    expect(h.flags[flag]!.owner).toBe(0);
    expect(h.buildings[h.castleOf(0)]!.owner).toBe(0);
    expect(h.buildings[h.castleOf(1)]!.owner).toBe(1);
  });

  it('an old save with no owner fields loads as a single, unclaimed colony', () => {
    const g = new Game(40, 20);
    g.placeBuilding(T.Castle, g.index(20, 10), false, 0);
    const data = g.serialize() as unknown as { flags: unknown[]; roads: unknown[]; buildings: unknown[] };
    for (const list of [data.flags, data.roads, data.buildings]) {
      for (const o of list) delete (o as { owner?: number }).owner;
    }
    const h = Game.restore(JSON.parse(JSON.stringify(data)) as Parameters<typeof Game.restore>[0]);
    expect(h.flags.every((f) => f.owner === 0)).toBe(true);
    expect(h.buildings.every((b) => b.owner === 0)).toBe(true);
    expect(h.ownerAt[h.index(20, 10)]).toBe(0); // territory still comes back, recomputed fresh
  });
});
