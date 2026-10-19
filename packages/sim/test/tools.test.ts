// Tools: every worker needs the tool of his trade, taken from a storage when he
// sets out and given back when his building goes. A toolmaker makes them from
// iron and planks, in the kinds the sliders ask for.
import { describe, expect, it } from 'vitest';
import {
  BState,
  BuildingType,
  Dir,
  Game,
  RES_COUNT,
  Res,
  TOOL_KINDS,
  TOOL_MAX,
  isTool,
  toolFor,
} from '../src/index.ts';
import * as sc from './scenarios.ts';

const T = BuildingType;

/** Castle with a road to a lumber hut site that already holds its materials. */
function colony(stock: [Res, number][], on = true, type: BuildingType = T.Lumberjack) {
  const g = new Game(24, 6);
  g.settlers = true;
  g.tools = on;
  const a = g.addFlag(2, 3);
  const b = g.addFlag(8, 3);
  const castle = g.buildings[g.addBuilding(T.Castle, a)]!;
  for (const [r, n] of stock) g.addStock(castle.index, r, n);
  g.addRoad(a, new Array<Dir>(6).fill(Dir.Right));
  const site = g.buildings[g.addBuilding(type, b, true)]!;
  for (let r = 0; r < site.need.length; r++) {
    site.stock[r] = site.need[r]!;
    g.created[r]! += site.need[r]!; // materials that were made elsewhere
  }
  return { g, a, b, castle, site };
}

const conserved = (g: Game) => {
  for (let r = 0; r < RES_COUNT; r++) {
    expect(g.created[r]! - g.consumed[r]! - g.lost[r]!, `res ${r} at ${g.tick}`).toBe(g.countItems(r as Res));
  }
};
const built = (g: Game, site: { constructing: boolean }) => {
  for (let i = 0; i < 6000 && site.constructing; i++) g.update();
  expect(site.constructing).toBe(false);
};

describe('which tool', () => {
  it('each trade has its own, and the tool kinds are all in use', () => {
    expect(toolFor(T.Lumberjack)).toBe(Res.Axe);
    expect(toolFor(T.Stonecutter)).toBe(Res.Pick);
    expect(toolFor(T.CoalMine)).toBe(Res.Pick);
    expect(toolFor(T.Forester)).toBe(Res.Shovel);
    expect(toolFor(T.Fisher)).toBe(Res.Rod);
    expect(toolFor(T.Farm)).toBe(Res.Scythe);
    expect(toolFor(T.Sawmill)).toBe(Res.Saw);
    expect(toolFor(T.IronSmelter)).toBe(Res.Hammer);
    expect(toolFor(T.Toolmaker)).toBe(Res.Hammer);
    for (const none of [T.Storage, T.Castle, T.Well, T.Mill, T.Baker]) expect(toolFor(none)).toBe(Res.None);
    const all = Object.values(T).filter((v): v is number => typeof v === 'number');
    const used = new Set(all.map((t) => toolFor(t)));
    for (const k of TOOL_KINDS) expect(used.has(k), Res[k]).toBe(true);
    for (const k of TOOL_KINDS) expect(isTool(k)).toBe(true);
    expect(isTool(Res.Iron)).toBe(false);
  });
});

describe('workers need their tool', () => {
  it('a finished building takes his tool from the castle and then the worker walks over', () => {
    const { g, castle, site } = colony([[Res.Axe, 2]]);
    built(g, site);
    for (let i = 0; i < 4; i++) g.update();
    expect(castle.stock[Res.Axe]).toBe(1);
    expect(site.hasTool).toBe(true);
    expect(site.state).toBe(BState.Arriving);
    for (let i = 0; i < 2000 && site.state === BState.Arriving; i++) g.update();
    expect(site.state).not.toBe(BState.Arriving);
    conserved(g);
  });

  it('another trade\'s tool is no use: a lumberjack waits for an axe even with picks and saws in store', () => {
    const { g, castle, site } = colony([[Res.Pick, 3], [Res.Saw, 3], [Res.Hammer, 3]]);
    built(g, site);
    for (let i = 0; i < 3000; i++) g.update();
    expect(site.state).toBe(BState.Arriving);
    expect(site.builderHome).toBe(-1);
    expect(site.hasTool).toBe(false);
    expect(castle.stock[Res.Pick]).toBe(3);
    g.addStock(castle.index, Res.Axe, 1);
    for (let i = 0; i < 4000 && site.state === BState.Arriving; i++) g.update();
    expect(site.state).not.toBe(BState.Arriving);
    expect(castle.stock[Res.Axe]).toBe(0);
    expect(castle.stock[Res.Pick]).toBe(3);
  });

  it('a mine takes a pick, a smelter a hammer', () => {
    for (const [type, tool] of [[T.CoalMine, Res.Pick], [T.IronSmelter, Res.Hammer]] as const) {
      const { g, castle, site } = colony([[tool, 1]], true, type);
      built(g, site);
      for (let i = 0; i < 4; i++) g.update();
      expect(castle.stock[tool], T[type]).toBe(0);
      expect(site.hasTool).toBe(true);
    }
  });

  it('demolishing the building gives the same kind of tool back', () => {
    const { g, castle, site } = colony([[Res.Axe, 1]]);
    built(g, site);
    for (let i = 0; i < 2000 && site.state === BState.Arriving; i++) g.update();
    expect(castle.stock[Res.Axe]).toBe(0);
    g.demolishBuilding(site.index);
    expect(castle.stock[Res.Axe]).toBe(1);
    expect(castle.stock[Res.Pick]).toBe(0);
    expect(site.hasTool).toBe(false);
    conserved(g);
  });

  it('a worker on his way when the building burns also gives it back', () => {
    const { g, castle, site } = colony([[Res.Axe, 1]]);
    built(g, site);
    for (let i = 0; i < 4; i++) g.update();
    expect(site.state).toBe(BState.Arriving);
    g.demolishBuilding(site.index);
    expect(castle.stock[Res.Axe]).toBe(1);
    for (let i = 0; i < 3000; i++) g.update();
    conserved(g);
  });

  it('storages, wells, mills and bakers need no tool', () => {
    for (const type of [T.Storage, T.Well, T.Mill, T.Baker]) {
      const { g, site } = colony([], true, type);
      built(g, site);
      for (let i = 0; i < 4000 && site.state === BState.Arriving; i++) g.update();
      expect(site.state, T[type]).not.toBe(BState.Arriving);
      expect(site.hasTool).toBe(false);
    }
  });

  it('off (the default): nobody needs a tool, as in the C++ reference', () => {
    const { g, site } = colony([], false);
    g.settlers = false;
    built(g, site);
    expect(site.state).toBe(BState.Idle);
  });

  it('a building placed finished by a script comes with its tool', () => {
    const g = new Game(16, 6);
    g.tools = true;
    const f = g.addFlag(4, 3);
    const b = g.buildings[g.addBuilding(T.Sawmill, f)]!;
    expect(b.hasTool).toBe(true);
    expect(g.created[Res.Saw]).toBe(1);
    conserved(g);
    const f2 = g.addFlag(10, 3);
    const mill = g.buildings[g.addBuilding(T.Mill, f2)]!;
    expect(mill.hasTool).toBe(false); // needs none
  });
});

describe('no storage to go home to', () => {
  it('the tool is lost with the building, and the books still balance', () => {
    const g = new Game(16, 6);
    g.tools = true;
    const f = g.addFlag(4, 3);
    const b = g.buildings[g.addBuilding(T.Sawmill, f)]!;
    g.demolishBuilding(b.index);
    expect(g.lost[Res.Saw]).toBe(1);
    expect(b.hasTool).toBe(false);
    conserved(g);
  });
});

describe('toolmaker', () => {
  function shop() {
    const g = new Game(24, 8);
    g.tools = true;
    const a = g.addFlag(2, 4);
    const b = g.addFlag(8, 4);
    const castle = g.buildings[g.addBuilding(T.Castle, a)]!;
    g.addRoad(a, new Array<Dir>(6).fill(Dir.Right));
    const maker = g.buildings[g.addBuilding(T.Toolmaker, b)]!;
    return { g, castle, maker };
  }
  const toolsIn = (_g: Game, castle: { stock: number[] }) => TOOL_KINDS.map((k) => castle.stock[k]!);

  it('turns iron and planks into tools, one each, and needs both', () => {
    const { g, castle, maker } = shop();
    g.addStock(castle.index, Res.Iron, 3);
    sc.run(g, 6000);
    expect(toolsIn(g, castle).reduce((a, b) => a + b, 0)).toBe(0); // no planks yet
    g.addStock(castle.index, Res.Plank, 5);
    sc.run(g, 15000);
    expect(toolsIn(g, castle).reduce((a, b) => a + b, 0)).toBe(3);
    expect(TOOL_KINDS).toContain(maker.out);
    conserved(g);
  });

  it('with no iron it makes nothing', () => {
    const { g, castle } = shop();
    g.addStock(castle.index, Res.Plank, 5);
    sc.run(g, 8000);
    expect(toolsIn(g, castle).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('makes the kinds the sliders ask for, in proportion', () => {
    const { g, castle } = shop();
    for (const k of TOOL_KINDS) g.setToolShare(k, 0);
    g.setToolShare(Res.Axe, 10);
    g.setToolShare(Res.Pick, 5);
    g.addStock(castle.index, Res.Iron, 30);
    g.addStock(castle.index, Res.Plank, 30);
    sc.run(g, 120000);
    const got = (k: Res) => castle.stock[k]!;
    expect(got(Res.Axe) + got(Res.Pick)).toBeGreaterThanOrEqual(12);
    expect(got(Res.Axe)).toBeGreaterThan(got(Res.Pick));
    expect(got(Res.Pick)).toBeGreaterThan(0);
    for (const k of [Res.Shovel, Res.Rod, Res.Scythe, Res.Saw, Res.Hammer]) expect(got(k), Res[k]).toBe(0);
    // about two axes to a pick
    expect(got(Res.Axe) / got(Res.Pick)).toBeGreaterThan(1.3);
    expect(got(Res.Axe) / got(Res.Pick)).toBeLessThan(3);
  });

  it('with every slider at 0 it makes nothing and keeps its materials', () => {
    const { g, castle, maker } = shop();
    for (const k of TOOL_KINDS) g.setToolShare(k, 0);
    g.addStock(castle.index, Res.Iron, 3);
    g.addStock(castle.index, Res.Plank, 3);
    sc.run(g, 12000);
    expect(toolsIn(g, castle).reduce((a, b) => a + b, 0)).toBe(0);
    expect(maker.stock[Res.Iron]! + castle.stock[Res.Iron]!).toBe(3);
  });

  it('a building waiting for a tool pulls that kind to the front', () => {
    const g = new Game(32, 8);
    g.tools = true;
    g.settlers = true;
    const a = g.addFlag(2, 4);
    const m = g.addFlag(8, 4);
    const w = g.addFlag(14, 4);
    const castle = g.buildings[g.addBuilding(T.Castle, a)]!;
    g.addRoad(a, new Array<Dir>(6).fill(Dir.Right));
    g.addRoad(m, new Array<Dir>(6).fill(Dir.Right));
    g.addBuilding(T.Toolmaker, m);
    for (const k of TOOL_KINDS) g.setToolShare(k, 1);
    g.setToolShare(Res.Axe, 10); // the sliders would pick axes ...
    const fisher = g.buildings[g.addBuilding(T.Fisher, w, true)]!; // ... but a fisher is waiting for a rod
    for (let r = 0; r < fisher.need.length; r++) {
      fisher.stock[r] = fisher.need[r]!;
      g.created[r]! += fisher.need[r]!;
    }
    g.addStock(castle.index, Res.Axe, 4); // plenty of axes already
    g.addStock(castle.index, Res.Iron, 3);
    g.addStock(castle.index, Res.Plank, 3);
    expect(g.chooseTool()).toBe(Res.Axe); // before anyone waits
    for (let i = 0; i < 6000 && fisher.constructing; i++) g.update();
    for (let i = 0; i < 40; i++) g.update();
    expect(fisher.state).toBe(BState.Arriving);
    expect(fisher.builderHome).toBe(-1);
    expect(g.chooseTool()).toBe(Res.Rod);
    for (let i = 0; i < 40000 && fisher.state === BState.Arriving; i++) g.update();
    expect(fisher.state).not.toBe(BState.Arriving);
    expect(fisher.hasTool).toBe(true);
    conserved(g);
  });

  it('a slider at 0 means never, even for a tool somebody is waiting for', () => {
    const { g, site } = colony([], true, T.Fisher);
    built(g, site);
    for (let i = 0; i < 40; i++) g.update();
    expect(site.state).toBe(BState.Arriving);
    expect(g.chooseTool()).toBe(Res.Rod); // waiting, default slider
    g.setToolShare(Res.Rod, 0);
    expect(g.chooseTool()).not.toBe(Res.Rod);
  });

  it('sliders are clamped', () => {
    const g = new Game(8, 8);
    g.setToolShare(Res.Saw, 99);
    g.setToolShare(Res.Rod, -4);
    expect(g.toolShare[TOOL_KINDS.indexOf(Res.Saw)]).toBe(TOOL_MAX);
    expect(g.toolShare[TOOL_KINDS.indexOf(Res.Rod)]).toBe(0);
    g.setToolShare(Res.Iron, 3); // not a tool: ignored
    expect(g.toolShare.length).toBe(TOOL_KINDS.length);
  });
});

describe('saving', () => {
  it('the rule, the sliders and the tools in hands survive a save and carry on identically', () => {
    const { g, site } = colony([[Res.Axe, 3]]);
    g.setToolShare(Res.Rod, 9);
    built(g, site);
    for (let i = 0; i < 40; i++) g.update();
    expect(site.hasTool).toBe(true);
    const copy = Game.restore(JSON.parse(JSON.stringify(g.serialize())));
    expect(copy.tools).toBe(true);
    expect(copy.toolShare).toEqual(g.toolShare);
    expect(copy.buildings[site.index]!.hasTool).toBe(true);
    for (let i = 0; i < 3000; i++) {
      g.update();
      copy.update();
    }
    expect(copy.fingerprint()).toBe(g.fingerprint());
    expect(copy.countItems(Res.Axe)).toBe(g.countItems(Res.Axe));
  });

  it('an older save loads with tools off and no sliders', () => {
    const { g } = colony([[Res.Axe, 3]]);
    const d = JSON.parse(JSON.stringify(g.serialize()));
    delete d.tools;
    delete d.toolShare;
    for (const b of d.buildings) delete b.hasTool;
    const old = Game.restore(d);
    expect(old.tools).toBe(false);
    expect(old.toolShare.every((w) => w === 5)).toBe(true);
    expect(old.buildings.every((b) => b.hasTool === false)).toBe(true);
  });

  it('a save made when there were fewer resources gets the new ones at zero', () => {
    const { g } = colony([[Res.Axe, 3]]);
    const d = JSON.parse(JSON.stringify(g.serialize()));
    const few = 8;
    for (const k of ['created', 'consumed', 'dispatched', 'lost']) d[k] = d[k].slice(0, few);
    for (const b of d.buildings) for (const k of ['stock', 'requested', 'incoming', 'need', 'used']) b[k] = b[k].slice(0, few);
    const old = Game.restore(d);
    expect(old.created.length).toBe(RES_COUNT);
    for (const b of old.buildings) for (const k of ['stock', 'requested', 'incoming', 'need', 'used'] as const) expect(b[k].length).toBe(RES_COUNT);
    for (let i = 0; i < 500; i++) old.update(); // and it runs
    expect(old.buildings.every((b) => b.stock.every((v) => Number.isInteger(v)))).toBe(true);
  });
});
