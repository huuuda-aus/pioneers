// The radial menu of a flag: what it offers, when it opens and closes, what
// each choice does.
import { describe, expect, it } from 'vitest';
import { BuildingType, Dir, Game, MapObject, MapObjects, Res, TerrainMap, buildNeeds } from '@sett/sim';
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
    expect(app.menu).toEqual({ flag: meadow, page: 'main' });
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
    expect(app.menu).toEqual({ flag: meadow, page: 'main' });
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
    expect(ids(app, meadow)).toEqual(['build', 'road', 'demolish']);
  });

  it('a flag on a mountain, joined to a storage by road, adds the geologist ready to go', () => {
    const { app, rock } = world();
    expect(ids(app, rock)).toEqual(['build', 'road', 'geologist', 'demolish']);
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

describe('the Build list', () => {
  const T = BuildingType;

  it('every flag without a building offers Build; a flag with one (the castle door) does not', () => {
    const { app, a, meadow } = world();
    expect(ids(app, meadow)[0]).toBe('build');
    expect(ids(app, a)).not.toContain('build');
  });

  it('lists every building with its cost, the ones that fit first', () => {
    const { app, meadow } = world();
    const list = app.buildOptions(meadow);
    expect(list.length).toBe(19);
    const firstOff = list.findIndex((o) => !o.enabled);
    expect(firstOff).toBeGreaterThan(0);
    for (let i = 0; i < list.length; i++) expect(list[i]!.enabled, `${list[i]!.name} at ${i}`).toBe(i < firstOff);
    for (const o of list) {
      const need = buildNeeds(o.type);
      expect(o.planks).toBe(need[Res.Plank]);
      expect(o.stones).toBe(need[Res.Stone]);
      expect(o.name.length).toBeGreaterThan(2);
    }
    expect(list.map((o) => o.type)).not.toContain(T.Castle);
    expect(new Set(list.map((o) => o.type)).size).toBe(19);
  });

  it('what fits depends on the ground: a mine on meadow does not, a lumberjack on rock does not', () => {
    const { app, meadow, rock } = world();
    const onMeadow = app.buildOptions(meadow);
    expect(onMeadow.find((o) => o.type === T.Lumberjack)!.enabled).toBe(true);
    const mine = onMeadow.find((o) => o.type === T.CoalMine)!;
    expect(mine.enabled).toBe(false);
    expect(mine.reason).toMatch(/mountain/);
    const onRock = app.buildOptions(rock);
    expect(onRock.find((o) => o.type === T.CoalMine)!.enabled).toBe(true);
    const lj = onRock.find((o) => o.type === T.Lumberjack)!;
    expect(lj.enabled).toBe(false);
    expect(lj.reason).toMatch(/mountain/);
  });

  it('agrees with the placement rules exactly: an option is enabled if and only if placeBuilding would succeed', () => {
    const { app, g, meadow, rock } = world();
    for (const f of [meadow, rock]) {
      for (const o of app.buildOptions(f)) {
        const probe = structuredClone(g.serialize());
        const copy = Game.restore(probe);
        let ok = true;
        try {
          copy.placeBuilding(o.type, copy.buildSpot(f), true);
        } catch {
          ok = false;
        }
        expect(ok, `${o.name} at flag ${f}`).toBe(o.enabled);
      }
    }
  });

  it('Build opens the list and keeps the menu open on that page; Back returns to the ring', () => {
    const { app, g, meadow } = world();
    app.click(...at(g, meadow));
    app.chooseFlagAction('build');
    expect(app.menu).toEqual({ flag: meadow, page: 'build' });
    app.menuBack();
    expect(app.menu).toEqual({ flag: meadow, page: 'main' });
  });

  it('picking a building puts its site here, door on this flag, and closes the menu', () => {
    const { app, g, meadow } = world();
    app.click(...at(g, meadow));
    app.chooseFlagAction('build');
    const before = g.buildings.length;
    app.buildFromMenu(T.Lumberjack);
    expect(g.buildings.length).toBe(before + 1);
    const b = g.buildings[g.buildings.length - 1]!;
    expect(b.type).toBe(T.Lumberjack);
    expect(b.flag).toBe(meadow);
    expect(b.constructing).toBe(true);
    expect(app.menu).toBeNull();
    expect(app.toast).toBe('');
  });

  it('a building that does not fit is refused with the reason, and the menu closes', () => {
    const { app, g, meadow } = world();
    app.click(...at(g, meadow));
    app.chooseFlagAction('build');
    const before = g.buildings.length;
    app.buildFromMenu(T.CoalMine);
    expect(g.buildings.length).toBe(before);
    expect(app.toast).toMatch(/mountain/);
    expect(app.menu).toBeNull();
  });

  it('after a building stands on the flag the menu no longer offers Build', () => {
    const { app, g, meadow } = world();
    app.click(...at(g, meadow));
    app.chooseFlagAction('build');
    app.buildFromMenu(T.Lumberjack);
    app.click(...at(g, meadow));
    expect(ids(app, meadow)).not.toContain('build');
  });

  it('Build is greyed out when nothing fits (trees all round)', () => {
    const { app, g } = world();
    const lone = g.addFlag(8, 18);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const p = g.index(8 + dx, 18 + dy);
      if (p !== g.flags[lone]!.pos && g.flagAtPos(p) < 0 && g.objects!.kindAt(p) === MapObject.None) g.objects!.set(p, MapObject.Tree);
    }
    const build = app.flagActions(lone).find((x) => x.id === 'build')!;
    expect(build.enabled).toBe(false);
    expect(build.reason).toMatch(/nothing can be built/);
    app.click(...at(g, lone));
    app.chooseFlagAction('build');
    expect(app.menu).toBeNull(); // greyed: it did not open the list
    expect(app.toast).toMatch(/Can't do that/);
  });

  it('picking is a command, saved soon after, and with no menu open it does nothing', () => {
    const { app } = world();
    app.buildFromMenu(T.Lumberjack);
    expect(app.game.buildings.length).toBe(1);
  });
});
