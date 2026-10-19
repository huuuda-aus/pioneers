// The client side of mining: every building and resource can be drawn, the
// tools exist, and the food slider is a command that gets saved.
import { describe, expect, it } from 'vitest';
import { BuildingType, OreKind, RES_COUNT, Res } from '@sett/sim';
import { makeScenario } from '../src/scenarios.ts';
import { App, SAVE_DEBOUNCE_MS } from '../src/app.ts';
import { BUILDING_COLOR, BUILDING_LABEL, BUILDING_NAME, ORE_COLOR, RES_COLOR, WORKER_LETTER } from '../src/palette.ts';
import { SAVE_KEY, type KV } from '../src/persistence.ts';
import { tradeOf } from '../src/people.ts';

class Mem implements KV {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('everything can be drawn', () => {
  const types = Object.values(BuildingType).filter((v): v is number => typeof v === 'number');

  it('every building has a colour, a label and a name', () => {
    for (const t of types) {
      expect(BUILDING_COLOR[t], `colour of ${BuildingType[t]}`).toBeDefined();
      expect(BUILDING_LABEL[t], `label of ${BuildingType[t]}`).toBeTruthy();
      expect(BUILDING_NAME[t], `name of ${BuildingType[t]}`).toBeTruthy();
    }
  });

  it('every worker has a letter and a trade, stores aside', () => {
    for (const t of types) {
      if (t === BuildingType.Storage || t === BuildingType.Castle) continue;
      expect(WORKER_LETTER[t], BuildingType[t]).toBeTruthy();
      expect(tradeOf(t), BuildingType[t]).not.toBeNull();
    }
  });

  it('every resource and every ore has a colour', () => {
    for (let r = 0; r < RES_COUNT; r++) expect(RES_COLOR[r], Res[r]).toBeDefined();
    for (const k of [OreKind.Stone, OreKind.Coal, OreKind.Iron, OreKind.Gold]) expect(ORE_COLOR[k]).toBeGreaterThan(0);
    expect(new Set(ORE_COLOR.slice(1)).size).toBe(4); // told apart on the map
  });
});

describe('placing the new buildings from the toolbar', () => {
  it('each tool places its building where the rules allow', () => {
    const app = new App('new');
    const g = app.game;
    // a spot on grass near the castle with room for a small building and its flag
    const smelters: [typeof app.tool, BuildingType][] = [
      ['ironsmelter', BuildingType.IronSmelter],
      ['goldsmelter', BuildingType.GoldSmelter],
    ];
    const castle = g.buildings[g.castle]!;
    let x = (castle.pos % g.cols) - 8;
    const y = Math.floor(castle.pos / g.cols) + 3;
    for (const [tool, type] of smelters) {
      app.setTool(tool);
      let placed = false;
      for (let dx = 0; dx < 14 && !placed; dx += 2) {
        const before = g.buildings.length;
        app.click(x + dx, y);
        placed = g.buildings.length > before;
      }
      expect(placed, tool).toBe(true);
      expect(g.buildings[g.buildings.length - 1]!.type).toBe(type);
      x += 2;
    }
  });
});

describe('the food slider', () => {
  it('is a command: it changes the game and is saved soon after', () => {
    const store = new Mem();
    const app = new App('new', store);
    app.saveNow();
    const before = store.getItem(SAVE_KEY);
    app.setFoodShare(OreKind.Coal, 3);
    expect(app.game.foodShare[OreKind.Coal]).toBe(3);
    for (let t = 0; t < SAVE_DEBOUNCE_MS + 100; t += 16) app.frame(16);
    expect(store.getItem(SAVE_KEY)).not.toBe(before);
    const again = new App('new', store);
    expect(again.game.foodShare[OreKind.Coal]).toBe(3);
  });
});

describe('the toolmaker sliders', () => {
  it('are a command: they change the game and are saved soon after', () => {
    const store = new Mem();
    const app = new App('new', store);
    app.saveNow();
    const before = store.getItem(SAVE_KEY);
    app.setToolShare(Res.Rod, 9);
    expect(app.game.toolShare[4 - 1]).toBe(9);
    for (let t = 0; t < SAVE_DEBOUNCE_MS + 100; t += 16) app.frame(16);
    expect(store.getItem(SAVE_KEY)).not.toBe(before);
    expect(new App('new', store).game.toolShare[3]).toBe(9);
  });
});

describe('tools in the starting games', () => {
  it('every scenario runs with tools on, and the new game starts with some of each kind in the castle', () => {
    for (const id of ['new', 'demo', 'food'] as const) expect(makeScenario(id).tools, id).toBe(true);
    const g = makeScenario('new');
    for (const k of [Res.Axe, Res.Pick, Res.Shovel, Res.Rod, Res.Scythe, Res.Saw, Res.Hammer]) expect(g.buildings[g.castle]!.stock[k], Res[k]).toBeGreaterThan(0);
  });

  it('the scripted scenarios hold together: goods are conserved with tools in hands', () => {
    for (const id of ['demo', 'food'] as const) {
      const g = makeScenario(id);
      for (let i = 0; i < 3000; i++) g.update();
      for (let r = 0; r < RES_COUNT; r++) {
        expect(g.created[r]! - g.consumed[r]! - g.lost[r]!, `${id} res ${r}`).toBe(g.countItems(r as Res));
      }
    }
  });
});
