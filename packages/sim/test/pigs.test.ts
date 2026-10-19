// Pigs: a pig farm turns wheat and water into pigs, a butcher turns pigs into
// meat, and meat is food for the mines like fish and bread.
import { describe, expect, it } from 'vitest';
import {
  BState,
  BuildingSize,
  BuildingType,
  Dir,
  FOOD,
  Game,
  MapObjects,
  OreKind,
  RES_COUNT,
  Res,
  TOOL_KINDS,
  TerrainMap,
  buildingSize,
  checkBuilding,
  isTool,
  priority,
  toolFor,
} from '../src/index.ts';
import * as sc from './scenarios.ts';

const T = BuildingType;

const conserved = (g: Game) => {
  for (let r = 0; r < RES_COUNT; r++) {
    expect(g.created[r]! - g.consumed[r]! - g.lost[r]!, `res ${r} at ${g.tick}`).toBe(g.countItems(r as Res));
  }
};

/** A castle with a road to a row of buildings. */
function row(types: BuildingType[], tools = false) {
  const g = new Game(48, 8);
  g.tools = tools;
  const castleFlag = g.addFlag(2, 4);
  const castle = g.buildings[g.addBuilding(T.Castle, castleFlag)]!;
  const out: Game['buildings'] = [];
  let prev = castleFlag;
  types.forEach((t, i) => {
    const f = g.addFlag(8 + i * 6, 4);
    g.addRoad(prev, new Array<Dir>(6).fill(Dir.Right));
    out.push(g.buildings[g.addBuilding(t, f)]!);
    prev = f;
  });
  return { g, castle, b: out };
}

describe('the pig farm', () => {
  it('needs wheat and water together and makes a pig from one of each', () => {
    const { g, castle, b } = row([T.PigFarm]);
    g.addStock(castle.index, Res.Wheat, 3);
    sc.run(g, 8000);
    expect(g.created[Res.Pig]).toBe(0); // no water
    g.addStock(castle.index, Res.Water, 5);
    sc.run(g, 16000);
    expect(g.created[Res.Pig]).toBe(3);
    expect(b[0]!.out).toBe(Res.Pig);
    conserved(g);
  });

  it('does not take flour or bread', () => {
    const { g, castle, b } = row([T.PigFarm]);
    g.addStock(castle.index, Res.Flour, 3);
    g.addStock(castle.index, Res.Wheat, 1);
    g.addStock(castle.index, Res.Water, 1);
    sc.run(g, 6000);
    expect(b[0]!.stock[Res.Flour]).toBe(0);
    expect(g.created[Res.Pig]).toBe(1);
  });

  it('is a large building, needs no tool', () => {
    expect(buildingSize(T.PigFarm)).toBe(BuildingSize.Large);
    expect(toolFor(T.PigFarm)).toBe(Res.None);
  });
});

describe('the butcher', () => {
  it('turns one pig into one meat, and takes only pigs', () => {
    const { g, castle, b } = row([T.Butcher]);
    g.addStock(castle.index, Res.Pig, 3);
    g.addStock(castle.index, Res.Fish, 2);
    sc.run(g, 12000);
    expect(g.created[Res.Meat]).toBe(3);
    expect(b[0]!.out).toBe(Res.Meat);
    expect(b[0]!.stock[Res.Fish]).toBe(0);
    conserved(g);
  });

  it('is a small building and needs a cleaver, the eighth kind of tool', () => {
    expect(buildingSize(T.Butcher)).toBe(BuildingSize.Small);
    expect(toolFor(T.Butcher)).toBe(Res.Cleaver);
    expect(isTool(Res.Cleaver)).toBe(true);
    expect(TOOL_KINDS).toContain(Res.Cleaver);
    expect(TOOL_KINDS.length).toBe(8);
    expect(isTool(Res.Pig)).toBe(false);
    expect(isTool(Res.Meat)).toBe(false);
  });

  it('a new butcher waits for a cleaver, like any trade waits for its tool', () => {
    const g = new Game(24, 6);
    g.tools = true;
    g.settlers = true;
    const a = g.addFlag(2, 3);
    const f = g.addFlag(8, 3);
    const castle = g.buildings[g.addBuilding(T.Castle, a)]!;
    g.addStock(castle.index, Res.Axe, 2);
    g.addRoad(a, new Array<Dir>(6).fill(Dir.Right));
    const site = g.buildings[g.addBuilding(T.Butcher, f, true)]!;
    for (let r = 0; r < site.need.length; r++) {
      site.stock[r] = site.need[r]!;
      g.created[r]! += site.need[r]!;
    }
    for (let i = 0; i < 6000 && site.constructing; i++) g.update();
    for (let i = 0; i < 2000; i++) g.update();
    expect(site.state).toBe(BState.Arriving);
    expect(site.builderHome).toBe(-1);
    g.addStock(castle.index, Res.Cleaver, 1);
    for (let i = 0; i < 4000 && site.state === BState.Arriving; i++) g.update();
    expect(site.state).not.toBe(BState.Arriving);
    expect(castle.stock[Res.Cleaver]).toBe(0);
  });
});

describe('meat is food', () => {
  it('is in the food group, wanted by a mine like fish and bread', () => {
    expect(FOOD).toContain(Res.Meat);
    const { b } = row([T.StoneMine]);
    const mine = b[0]!;
    expect(priority(mine, Res.Meat)).toBeGreaterThan(0);
    expect(priority(mine, Res.Meat)).toBe(priority(mine, Res.Fish));
    const smelter = row([T.IronSmelter]).b[0]!;
    expect(priority(smelter, Res.Meat)).toBe(0); // only mines eat
  });

  it('a mine counts meat, fish and bread together towards what it will stock', () => {
    const { g, b } = row([T.StoneMine]);
    const mine = b[0]!;
    void g;
    const empty = priority(mine, Res.Meat);
    mine.stock[Res.Fish] = 2;
    mine.stock[Res.Bread] = 1;
    expect(priority(mine, Res.Meat)).toBeLessThan(empty);
    mine.stock[Res.Meat] = 1; // 4 in all: full
    expect(priority(mine, Res.Meat)).toBe(0);
    expect(priority(mine, Res.Fish)).toBe(0);
  });

  it('the food slider scales meat too, and a mine at 0 gets none', () => {
    const { g, b } = row([T.CoalMine]);
    const mine = b[0]!;
    const full = priority(mine, Res.Meat);
    g.setFoodShare(OreKind.Coal, 3);
    expect(priority(mine, Res.Meat)).toBeLessThan(full);
    g.setFoodShare(OreKind.Coal, 0);
    expect(priority(mine, Res.Meat)).toBe(0);
  });

  it('a mine eats meat to dig: one meat, one ore', () => {
    const g = new Game(28, 20, TerrainMap.flat(28, 20, 20), new MapObjects(28, 20));
    g.objects!.setOre(g.index(11, 8), 9, OreKind.Stone);
    const mine = g.buildings[g.placeBuilding(T.StoneMine, g.index(10, 8), false)]!;
    mine.stock[Res.Meat] = 3;
    sc.run(g, 6000);
    expect(g.created[Res.Stone]).toBe(3);
    expect(g.consumed[Res.Meat]).toBe(3);
    expect(g.objects!.oreNear(g.index(10, 8), OreKind.Stone)).toBe(6);
  });
});

describe('the whole chain', () => {
  it('wheat and water become pigs, pigs meat, meat stone, and no goods are lost on the way', () => {
    const g = new Game(48, 8, TerrainMap.flat(48, 8, 20), new MapObjects(48, 8));
    const cf = g.addFlag(2, 4);
    const castle = g.buildings[g.addBuilding(T.Castle, cf)]!;
    const pf = g.addFlag(8, 4);
    const bf = g.addFlag(14, 4);
    const mf = g.addFlag(20, 4);
    g.addRoad(cf, new Array<Dir>(6).fill(Dir.Right));
    g.addRoad(pf, new Array<Dir>(6).fill(Dir.Right));
    g.addRoad(bf, new Array<Dir>(6).fill(Dir.Right));
    g.addBuilding(T.PigFarm, pf);
    g.addBuilding(T.Butcher, bf);
    g.objects!.setOre(g.index(18, 3), 8, OreKind.Stone);
    const mine = g.buildings[g.addBuilding(T.StoneMine, mf)]!;
    g.addStock(castle.index, Res.Wheat, 4);
    g.addStock(castle.index, Res.Water, 4);
    for (let i = 0; i < 80; i++) {
      sc.run(g, 250);
      conserved(g);
    }
    expect(g.created[Res.Pig]).toBe(4);
    expect(g.created[Res.Meat]).toBe(4);
    expect(g.created[Res.Stone]).toBe(4);
    expect(mine.stock[Res.Meat]).toBe(0);
  });
});

describe('saves', () => {
  it('a save from before cleavers loads with the eight tools, the new one at the usual share', () => {
    const { g } = row([T.PigFarm]);
    const d = JSON.parse(JSON.stringify(g.serialize()));
    d.toolShare = d.toolShare.slice(0, 7);
    for (const k of ['created', 'consumed', 'dispatched', 'lost']) d[k] = d[k].slice(0, 20);
    for (const b of d.buildings) for (const k of ['stock', 'requested', 'incoming', 'need', 'used']) b[k] = b[k].slice(0, 20);
    const old = Game.restore(d);
    expect(old.toolShare.length).toBe(8);
    expect(old.toolShare[7]).toBe(5);
    for (const b of old.buildings) expect(b.stock.length).toBe(RES_COUNT);
    for (let i = 0; i < 500; i++) old.update();
    expect(old.buildings.every((b) => b.stock.every((v) => Number.isInteger(v)))).toBe(true);
  });

  it('pigs and meat survive a save and the copy carries on identically', () => {
    const { g, castle } = row([T.PigFarm, T.Butcher]);
    g.addStock(castle.index, Res.Wheat, 3);
    g.addStock(castle.index, Res.Water, 3);
    sc.run(g, 3000);
    const copy = Game.restore(JSON.parse(JSON.stringify(g.serialize())));
    sc.run(g, 6000);
    sc.run(copy, 6000);
    expect(copy.fingerprint()).toBe(g.fingerprint());
    expect(copy.created[Res.Meat]).toBe(g.created[Res.Meat]);
  });
});

describe('placement', () => {
  it('both can be placed on grass and not on a mountain', () => {
    const meadow = new Game(24, 20, undefined, new MapObjects(24, 20));
    const rock = new Game(24, 20, TerrainMap.flat(24, 20, 20), new MapObjects(24, 20));
    for (const t of [T.PigFarm, T.Butcher]) {
      expect(checkBuilding(meadow, t, meadow.index(10, 8)).ok, T[t]).toBe(true);
      expect(checkBuilding(rock, t, rock.index(10, 8)).reason, T[t]).toMatch(/mountain/);
    }
  });
});
