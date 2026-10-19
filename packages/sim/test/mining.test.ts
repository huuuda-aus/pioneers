// Four kinds of ore (stone, coal, iron, gold), the mines that dig them, the
// smelters that turn ore and coal into metal, and the food slider that splits
// food between the mines.
import { describe, expect, it } from 'vitest';
import {
  BState,
  BuildingType,
  Dir,
  FOOD_MAX,
  Game,
  MapObjects,
  OreKind,
  RES_COUNT,
  Res,
  TerrainMap,
  checkBuilding,
  generateObjects,
  generateTerrain,
  oreKindOf,
  priority,
} from '../src/index.ts';
import * as sc from './scenarios.ts';

const T = BuildingType;
const COLS = 28;
const ROWS = 20;
const at = (g: Game, x: number, y: number) => g.index(x, y);
const rock = (): Game => new Game(COLS, ROWS, TerrainMap.flat(COLS, ROWS, 20), new MapObjects(COLS, ROWS));
const objs = (g: Game): MapObjects => g.objects!;

describe('kinds of ore', () => {
  const mines: [BuildingType, OreKind, Res][] = [
    [T.StoneMine, OreKind.Stone, Res.Stone],
    [T.CoalMine, OreKind.Coal, Res.Coal],
    [T.IronMine, OreKind.Iron, Res.IronOre],
    [T.GoldMine, OreKind.Gold, Res.GoldOre],
  ];

  for (const [type, kind, out] of mines) {
    it(`a ${OreKind[kind]} mine digs ${OreKind[kind]} ore into ${Res[out]}, and nothing else`, () => {
      const g = rock();
      for (const k of [OreKind.Stone, OreKind.Coal, OreKind.Iron, OreKind.Gold]) {
        objs(g).setOre(at(g, 11, 6 + k), 5, k); // one point of each kind in reach
      }
      const mine = g.buildings[g.placeBuilding(type, at(g, 10, 8), false)]!;
      mine.stock[Res.Fish] = 3;
      sc.run(g, 5000);
      expect(mine.out).toBe(out);
      expect(g.created[out]).toBe(3);
      expect(objs(g).oreNear(at(g, 10, 8), kind)).toBe(5 - 3);
      for (const other of [OreKind.Stone, OreKind.Coal, OreKind.Iron, OreKind.Gold]) {
        if (other !== kind) expect(objs(g).oreNear(at(g, 10, 8), other)).toBe(5);
      }
    });
  }

  it('a mine ignores ore of another kind: with none of its own it stops without eating', () => {
    const g = rock();
    objs(g).setOre(at(g, 11, 8), 1, OreKind.Coal); // so the mine may be placed
    const mine = g.buildings[g.placeBuilding(T.CoalMine, at(g, 10, 8), false)]!;
    objs(g).setOre(at(g, 11, 8), 9, OreKind.Gold); // the coal is replaced by gold
    mine.stock[Res.Bread] = 2;
    sc.run(g, 2000);
    expect(mine.state).toBe(BState.NoResource);
    expect(mine.stock[Res.Bread]).toBe(2);
    expect(g.created[Res.Coal]).toBe(0);
  });

  it('every kind of mine can be placed on any mountain, ore or not', () => {
    const g = rock();
    for (const t of [T.StoneMine, T.CoalMine, T.IronMine, T.GoldMine]) expect(checkBuilding(g, t, at(g, 10, 8)).ok, T[t]).toBe(true);
  });

  it('only the mines have an ore kind', () => {
    expect(oreKindOf(T.Sawmill)).toBe(OreKind.None);
    expect(oreKindOf(T.IronSmelter)).toBe(OreKind.None);
    expect(oreKindOf(T.GoldMine)).toBe(OreKind.Gold);
  });

  it('a generated map has all four kinds, only under mountains, in a sensible mix', () => {
    const t = generateTerrain({ cols: 64, rows: 48, seed: 3 });
    const o = generateObjects(t, 3);
    const count = [0, 0, 0, 0, 0];
    for (let p = 0; p < 64 * 48; p++) {
      if (o.ore[p]! > 0) {
        expect(o.oreKind[p]).not.toBe(OreKind.None);
        expect(t.heightAt(p)).toBeGreaterThanOrEqual(15);
        count[o.oreKind[p]!]!++;
      } else expect(o.oreKind[p]).toBe(OreKind.None);
    }
    const total = count.reduce((a, b) => a + b, 0);
    for (const k of [OreKind.Stone, OreKind.Coal, OreKind.Iron, OreKind.Gold]) expect(count[k]).toBeGreaterThan(total * 0.08);
    expect(count[OreKind.Gold]).toBeLessThan(count[OreKind.Coal]!);
    const again = generateObjects(t, 3);
    expect(Array.from(again.oreKind)).toEqual(Array.from(o.oreKind));
  });
});

describe('smelters', () => {
  /** Castle with a road to one smelter at the far end. */
  function works(type: BuildingType) {
    const g = new Game(24, 8);
    const a = g.addFlag(2, 4);
    const b = g.addFlag(8, 4);
    const castle = g.buildings[g.addBuilding(T.Castle, a)]!;
    g.addRoad(a, new Array<Dir>(6).fill(Dir.Right));
    const smelter = g.buildings[g.addBuilding(type, b)]!;
    return { g, castle, smelter };
  }

  it('iron needs ore and coal together', () => {
    const { g, castle, smelter } = works(T.IronSmelter);
    castle.stock[Res.IronOre] = 3;
    sc.run(g, 6000);
    expect(g.created[Res.Iron]).toBe(0); // no coal
    castle.stock[Res.Coal] = 5;
    sc.run(g, 12000);
    expect(g.created[Res.Iron]).toBe(3);
    expect(smelter.out).toBe(Res.Iron);
  });

  it('gold takes gold ore and coal, and does not take iron ore', () => {
    const { g, castle, smelter } = works(T.GoldSmelter);
    castle.stock[Res.IronOre] = 4;
    castle.stock[Res.GoldOre] = 2;
    castle.stock[Res.Coal] = 4;
    sc.run(g, 12000);
    expect(g.created[Res.Gold]).toBe(2);
    expect(smelter.stock[Res.IronOre]).toBe(0);
    expect(g.created[Res.Iron]).toBe(0);
  });

  it('goods are conserved across ore, coal and metal', () => {
    const { g, castle } = works(T.IronSmelter);
    castle.stock[Res.IronOre] = 4;
    castle.stock[Res.Coal] = 4;
    for (let r = 0; r < RES_COUNT; r++) g.created[r]! += castle.stock[r]!;
    for (let i = 0; i < 60; i++) {
      sc.run(g, 200);
      for (let r = 0; r < RES_COUNT; r++) {
        expect(g.created[r]! - g.consumed[r]! - g.lost[r]!, `res ${r} at ${g.tick}`).toBe(g.countItems(r as Res));
      }
    }
    expect(g.created[Res.Iron]).toBe(4);
  });
});

describe('the food slider', () => {
  it('a mine with a bigger share is wanted more, one with none is not wanted at all', () => {
    const g = new Game(8, 8);
    const f1 = g.addFlag(2, 2);
    const f2 = g.addFlag(5, 5);
    const m1 = g.buildings[g.addBuilding(T.CoalMine, f1)]!;
    const m2 = g.buildings[g.addBuilding(T.IronMine, f2)]!;
    const base = priority(m1, Res.Fish);
    expect(base).toBeGreaterThan(0);
    expect(priority(m2, Res.Fish)).toBe(base); // equal shares
    g.setFoodShare(OreKind.Iron, 3);
    expect(priority(m2, Res.Fish)).toBeLessThan(priority(m1, Res.Fish));
    expect(priority(m2, Res.Fish)).toBeGreaterThan(0);
    g.setFoodShare(OreKind.Iron, 0);
    expect(priority(m2, Res.Fish)).toBe(0);
    expect(priority(m2, Res.Bread)).toBe(0);
    expect(priority(m1, Res.Bread)).toBe(base);
  });

  it('the slider does not touch other goods', () => {
    const g = new Game(8, 8);
    const f = g.addFlag(2, 2);
    const smelter = g.buildings[g.addBuilding(T.IronSmelter, f)]!;
    const before = priority(smelter, Res.Coal);
    g.setFoodShare(OreKind.Iron, 0);
    expect(priority(smelter, Res.Coal)).toBe(before);
  });

  it('moving a slider reaches mines already built, and mines built later', () => {
    const g = new Game(12, 8);
    const f1 = g.addFlag(2, 2);
    const early = g.buildings[g.addBuilding(T.GoldMine, f1)]!;
    g.setFoodShare(OreKind.Gold, 4);
    expect(early.foodWeight).toBe(4);
    const f2 = g.addFlag(8, 5);
    const late = g.buildings[g.addBuilding(T.GoldMine, f2)]!;
    expect(late.foodWeight).toBe(4);
    g.setFoodShare(OreKind.Gold, 99);
    expect(late.foodWeight).toBe(FOOD_MAX);
    g.setFoodShare(OreKind.Gold, -5);
    expect(late.foodWeight).toBe(0);
  });

  it('a finished construction site takes the setting too', () => {
    const g = new Game(16, 8);
    g.settlers = false;
    const a = g.addFlag(2, 4);
    const b = g.addFlag(8, 4);
    g.addBuilding(T.Castle, a);
    g.addRoad(a, new Array<Dir>(6).fill(Dir.Right));
    g.setFoodShare(OreKind.Coal, 2);
    const site = g.buildings[g.addBuilding(T.CoalMine, b, true)]!;
    for (let r = 0; r < site.need.length; r++) site.stock[r] = site.need[r]!;
    for (let i = 0; i < 5000 && site.constructing; i++) g.update();
    expect(site.constructing).toBe(false);
    expect(site.foodWeight).toBe(2);
  });

  it('food actually goes to the mine with the bigger share first', () => {
    const deliveries = (wCoal: number, wIron: number) => {
      const g = new Game(32, 12, TerrainMap.flat(32, 12, 20), new MapObjects(32, 12));
      const c = g.addFlag(10, 6);
      const fa = g.addFlag(16, 6);
      const fb = g.addFlag(10, 10);
      const castle = g.buildings[g.addBuilding(T.Castle, c)]!;
      g.addRoad(c, new Array<Dir>(6).fill(Dir.Right));
      g.addRoad(c, [Dir.Down, Dir.Down, Dir.Down, Dir.Down]);
      const coal = g.buildings[g.addBuilding(T.CoalMine, fa)]!;
      const iron = g.buildings[g.addBuilding(T.IronMine, fb)]!;
      g.setFoodShare(OreKind.Coal, wCoal);
      g.setFoodShare(OreKind.Iron, wIron);
      castle.stock[Res.Fish] = 6;
      sc.run(g, 1200);
      const got = (b: typeof coal) => b.stock[Res.Fish]! + b.requested[Res.Fish]!;
      return { coal: got(coal), iron: got(iron), castle: castle.stock[Res.Fish]! };
    };
    const even = deliveries(10, 10);
    expect(even.coal + even.iron).toBeGreaterThan(0);
    const favour = deliveries(10, 2);
    const reverse = deliveries(2, 10);
    expect(favour.coal).toBeGreaterThan(favour.iron);
    expect(reverse.iron).toBeGreaterThan(reverse.coal);
    const none = deliveries(10, 0);
    expect(none.iron).toBe(0);
    expect(none.coal).toBeGreaterThan(0);
    expect(none.castle).toBeGreaterThan(0); // the rest stays in the castle
  });

  it('survives a save, and an older save gets full shares', () => {
    const g = new Game(12, 8);
    const f = g.addFlag(2, 2);
    const mine = g.buildings[g.addBuilding(T.IronMine, f)]!;
    g.setFoodShare(OreKind.Iron, 3);
    const copy = Game.restore(JSON.parse(JSON.stringify(g.serialize())));
    expect(copy.foodShare[OreKind.Iron]).toBe(3);
    expect(copy.buildings[mine.index]!.foodWeight).toBe(3);
    const d = JSON.parse(JSON.stringify(g.serialize()));
    delete d.foodShare;
    for (const b of d.buildings) delete b.foodWeight;
    const old = Game.restore(d);
    expect(old.foodShare[OreKind.Iron]).toBe(FOOD_MAX);
    expect(old.buildings[mine.index]!.foodWeight).toBe(FOOD_MAX);
  });
});

describe('saving ore kinds', () => {
  it('kinds survive, and old stone-only saves read as stone', () => {
    const g = rock();
    objs(g).setOre(at(g, 11, 8), 5, OreKind.Gold);
    objs(g).setOre(at(g, 12, 8), 4, OreKind.Coal);
    const copy = Game.restore(JSON.parse(JSON.stringify(g.serialize())));
    expect(copy.objects!.oreKind[at(g, 11, 8)]).toBe(OreKind.Gold);
    expect(copy.objects!.oreKind[at(g, 12, 8)]).toBe(OreKind.Coal);
    const d = JSON.parse(JSON.stringify(g.serialize()));
    delete d.objects.oreKind;
    const old = Game.restore(d);
    expect(old.objects!.oreKind[at(g, 11, 8)]).toBe(OreKind.Stone);
    expect(old.objects!.oreKind[at(g, 5, 5)]).toBe(OreKind.None);
  });
});
