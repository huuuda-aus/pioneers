// The radial menu of a flag: what it offers, when it opens and closes, what
// each choice does.
import { describe, expect, it } from 'vitest';
import { BuildingType, Dir, Game, MapObjects, Res, TerrainMap } from '@sett/sim';
import { App } from '../src/app.ts';

const COLS = 32;
const ROWS = 22;

/** Meadow on the left, a ramp, then mountain on the right. */
function ramp(): TerrainMap {
  const t = TerrainMap.flat(COLS, ROWS, 8);
  const h = [11, 14, 17];
  for (let y = 0; y < ROWS; y++) for (let x = 13; x < COLS; x++) t.setHeight(y * COLS + x, x < 16 ? h[x - 13]! : 20);
  return t;
}

/** A mountain plateau with a castle flag and a flag out on the rock joined by road, plus a flag on meadow. */
function world(opts: { hammer?: boolean } = {}) {
  const app = new App('new');
  const g = new Game(COLS, ROWS, ramp(), new MapObjects(COLS, ROWS));
  g.tools = true;
  const a = g.addFlag(4, 10);
  const rock = g.addFlag(18, 10);
  const meadow = g.addFlag(8, 10);
  const castle = g.buildings[g.addBuilding(BuildingType.Castle, a)]!;
  g.addStock(castle.index, Res.Hammer, opts.hammer === false ? 0 : 2);
  g.addRoad(a, new Array<Dir>(4).fill(Dir.Right)); // castle - meadow flag
  g.addRoad(meadow, new Array<Dir>(10).fill(Dir.Right)); // meadow flag - rock flag, up the slope
  const lonely = g.addFlag(22, 16); // a flag on the rock with no road at all
  app.game = g;
  return { app, g, a, rock, meadow, castle, lonely };
}
const at = (g: Game, f: number): [number, number] => [g.flags[f]!.pos % COLS, Math.floor(g.flags[f]!.pos / COLS)];
const ids = (app: App, f: number) => app.flagActions(f).map((a) => a.id);

describe('opening and closing', () => {
  it('clicking a flag with the Select tool opens its menu', () => {
    const { app, g, meadow } = world();
    app.click(...at(g, meadow));
    expect(app.menu).toEqual({ flag: meadow });
    expect(app.selection).toEqual({ kind: 'flag', index: meadow });
  });

  it('clicking elsewhere closes it', () => {
    const { app, g, meadow } = world();
    app.click(...at(g, meadow));
    app.click(20, 3); // empty ground
    expect(app.menu).toBeNull();
  });

  it('clicking the same flag again keeps one menu open (it reopens, it does not stack)', () => {
    const { app, g, meadow } = world();
    app.click(...at(g, meadow));
    app.click(...at(g, meadow));
    expect(app.menu).toEqual({ flag: meadow });
  });

  it('choosing another tool, or the Escape key (which selects), closes it', () => {
    const { app, g, meadow } = world();
    app.click(...at(g, meadow));
    app.setTool('flag');
    expect(app.menu).toBeNull();
    app.setTool('select');
    app.click(...at(g, meadow));
    app.setTool('select'); // what Escape does
    expect(app.menu).toBeNull();
  });

  it('other tools never open it', () => {
    const { app, g, meadow } = world();
    for (const tool of ['road', 'flag', 'demolish', 'geologist'] as const) {
      app.setTool(tool);
      app.click(...at(g, meadow));
      expect(app.menu, tool).toBeNull();
      app.roadStart = -1;
    }
  });

  it('closeMenu closes it, and a flag that is demolished takes its menu with it', () => {
    const { app, g, meadow } = world();
    app.click(...at(g, meadow));
    app.closeMenu();
    expect(app.menu).toBeNull();
    app.click(...at(g, meadow));
    g.demolishFlag(meadow);
    app.frame(20);
    expect(app.menu).toBeNull();
  });

  it('a new game has no menu', () => {
    const { app, g, meadow } = world();
    app.click(...at(g, meadow));
    app.loadScenario('new');
    expect(app.menu).toBeNull();
  });
});

describe('what it offers', () => {
  it('a flag on meadow: a road and removing the flag, no geologist', () => {
    const { app, meadow } = world();
    expect(ids(app, meadow)).toEqual(['road', 'demolish']);
  });

  it('a flag on a mountain, joined to a storage by road, adds the geologist ready to go', () => {
    const { app, rock } = world();
    expect(ids(app, rock)).toEqual(['road', 'geologist', 'demolish']);
    const geo = app.flagActions(rock).find((x) => x.id === 'geologist')!;
    expect(geo.enabled).toBe(true);
    expect(geo.reason).toBe('');
  });

  it('on a mountain flag with no road he is greyed out and says why', () => {
    const { app, lonely } = world();
    expect(ids(app, lonely)).toContain('geologist');
    const geo = app.flagActions(lonely).find((x) => x.id === 'geologist')!;
    expect(geo.enabled).toBe(false);
    expect(geo.reason).toMatch(/storage joined by road/);
  });

  it('without a hammer in store he is greyed out and says so', () => {
    const { app, rock } = world({ hammer: false });
    const geo = app.flagActions(rock).find((x) => x.id === 'geologist')!;
    expect(geo.enabled).toBe(false);
    expect(geo.reason).toMatch(/hammer/);
  });

  it('removing a flag is greyed out for a flag that cannot go, with the reason', () => {
    const { app, g, a } = world();
    const d = app.flagActions(a).find((x) => x.id === 'demolish')!;
    expect(d.enabled).toBe(false); // the castle's door flag
    expect(d.reason).toBe(g.checkDemolishFlag(a).reason);
  });
});

describe('what a choice does', () => {
  it('Road: the Road tool is on and this flag is where the road starts', () => {
    const { app, g, meadow } = world();
    app.click(...at(g, meadow));
    app.chooseFlagAction('road');
    expect(app.tool).toBe('road');
    expect(app.roadStart).toBe(meadow);
    expect(app.menu).toBeNull();
    expect(app.toast).toMatch(/where the road ends/);
  });

  it('Road, then a click on another flag, builds the road', () => {
    const { app, g, a } = world();
    const spare = g.addFlag(8, 14);
    app.click(...at(g, spare));
    app.chooseFlagAction('road');
    const before = g.roads.filter((r) => !r.removed).length;
    app.click(...at(g, a));
    expect(g.roads.filter((r) => !r.removed).length).toBe(before + 1);
  });

  it('Geologist: he is sent', () => {
    const { app, g, rock } = world();
    app.click(...at(g, rock));
    app.chooseFlagAction('geologist');
    expect(g.geologists.length).toBe(1);
    expect(g.geologists[0]!.flag).toBe(rock);
    expect(app.menu).toBeNull();
  });

  it('a greyed-out choice does nothing but say why, and closes the menu', () => {
    const { app, g, rock } = world({ hammer: false });
    app.click(...at(g, rock));
    app.chooseFlagAction('geologist');
    expect(g.geologists.length).toBe(0);
    expect(app.toast).toMatch(/hammer/);
    expect(app.menu).toBeNull();
  });

  it('Remove flag: it goes (its two roads join)', () => {
    const { app, g } = world();
    const mid = g.addFlag(6, 10);
    void mid;
    const flags = g.flags.filter((f) => !f.removed).length;
    // a flag on the open ground with no roads can go
    const lone = g.addFlag(8, 18);
    app.click(...at(g, lone));
    app.chooseFlagAction('demolish');
    expect(g.flags[lone]!.removed).toBe(true);
    expect(g.flags.filter((f) => !f.removed).length).toBe(flags);
    expect(app.selection).toBeNull();
    expect(app.menu).toBeNull();
  });

  it('choosing with no menu open does nothing', () => {
    const { app } = world();
    app.chooseFlagAction('road');
    expect(app.tool).toBe('select');
  });

  it('choosing is a command: the game is saved soon after', () => {
    const store = new Map<string, string>();
    const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const app = new App('new', kv);
    const g = new Game(COLS, ROWS, ramp(), new MapObjects(COLS, ROWS));
    const lone = g.addFlag(8, 18);
    app.game = g;
    app.screen = 'game';
    app.saveNow();
    const before = store.get('sett.save');
    app.click(8, 18);
    app.chooseFlagAction('demolish');
    for (let ms = 0; ms < 1200; ms += 16) app.frame(16);
    expect(store.get('sett.save')).not.toBe(before);
    void lone;
  });
});
