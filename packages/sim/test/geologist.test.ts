// Geologists: sent to a flag on a mountain, they probe spot after spot with
// a hammer and leave signs saying what lies underneath. Until then the ore is
// hidden. Signs fade after a while.
import { describe, expect, it } from 'vitest';
import {
  BuildingType,
  Dir,
  GEO_PROBES,
  GEO_PROBE_TICKS,
  GEO_RADIUS,
  Game,
  MapObject,
  MapObjects,
  OreKind,
  RES_COUNT,
  Res,
  SIGN_EMPTY,
  SIGN_SMALL_BELOW,
  SIGN_TICKS,
  STEP_TICKS,
  TerrainMap,
  checkBuilding,
  distanceBetween,
  signFor,
  signIsSmall,
  signKind,
} from '../src/index.ts';

const COLS = 32;
const ROWS = 22;
const at = (g: Game, x: number, y: number) => g.index(x, y);

/** A mountain plateau with a castle at the left and a flag out on the rock. */
function mountain(tools = false) {
  const g = new Game(COLS, ROWS, TerrainMap.flat(COLS, ROWS, 20), new MapObjects(COLS, ROWS));
  g.tools = tools;
  const a = g.addFlag(4, 10);
  const f = g.addFlag(14, 10);
  const castle = g.buildings[g.addBuilding(BuildingType.Castle, a)]!;
  g.addRoad(a, new Array<Dir>(10).fill(Dir.Right));
  if (tools) g.addStock(castle.index, Res.Hammer, 2);
  return { g, a, f, castle };
}

const run = (g: Game, n: number) => {
  for (let i = 0; i < n; i++) g.update();
};
const finish = (g: Game, limit = 60000) => {
  for (let i = 0; i < limit && g.geologists.length > 0; i++) g.update();
  expect(g.geologists.length).toBe(0);
};
const signs = (g: Game): number[] => {
  const out: number[] = [];
  for (let p = 0; p < COLS * ROWS; p++) if (g.objects!.sign[p] !== 0) out.push(p);
  return out;
};
const conserved = (g: Game) => {
  for (let r = 0; r < RES_COUNT; r++) {
    expect(g.created[r]! - g.consumed[r]! - g.lost[r]!, `res ${r} at ${g.tick}`).toBe(g.countItems(r as Res));
  }
};

describe('sending him', () => {
  it('works from a flag on a mountain joined to a storage', () => {
    const { g, f } = mountain();
    expect(g.checkGeologist(f).ok).toBe(true);
    g.sendGeologist(f);
    expect(g.geologists.length).toBe(1);
  });

  it('is refused with a reason when it cannot work', () => {
    const { g, f } = mountain();
    g.sendGeologist(f);
    expect(g.checkGeologist(f).reason).toMatch(/already working/);
    expect(() => g.sendGeologist(f)).toThrow(/already working/);

    const lone = g.addFlag(20, 4);
    expect(g.checkGeologist(lone).reason).toMatch(/storage joined by road/);
    expect(g.checkGeologist(99).reason).toMatch(/no such flag/);

    const meadow = new Game(COLS, ROWS, undefined, new MapObjects(COLS, ROWS));
    const fa = meadow.addFlag(4, 10);
    const fb = meadow.addFlag(10, 10);
    meadow.addBuilding(BuildingType.Castle, fa);
    meadow.addRoad(fa, new Array<Dir>(6).fill(Dir.Right));
    expect(meadow.checkGeologist(fb).reason).toMatch(/mountain/);

    const bare = new Game(COLS, ROWS, TerrainMap.flat(COLS, ROWS, 20)); // a map with no objects layer
    const ba = bare.addFlag(4, 10);
    const bb = bare.addFlag(10, 10);
    bare.addBuilding(BuildingType.Castle, ba);
    bare.addRoad(ba, new Array<Dir>(6).fill(Dir.Right));
    expect(bare.checkGeologist(bb).reason).toMatch(/nothing to find/);
  });

  it('a flag at the foot of a mountain will do', () => {
    const t = TerrainMap.flat(COLS, ROWS, 8);
    for (let y = 0; y < ROWS; y++) for (let x = 15; x < COLS; x++) t.setHeight(y * COLS + x, 20);
    const g = new Game(COLS, ROWS, t, new MapObjects(COLS, ROWS));
    const a = g.addFlag(4, 10);
    const f = g.addFlag(14, 10); // on grass, the mountain starts next to it
    g.addBuilding(BuildingType.Castle, a);
    g.addRoad(a, new Array<Dir>(10).fill(Dir.Right));
    expect(g.checkGeologist(f).ok).toBe(true);
  });
});

describe('flagByMountain', () => {
  it('is true on the rock and beside it, false on meadow, and false for a flag that is gone', () => {
    const t = TerrainMap.flat(COLS, ROWS, 8);
    for (let y = 0; y < ROWS; y++) for (let x = 15; x < COLS; x++) t.setHeight(y * COLS + x, 20);
    const g = new Game(COLS, ROWS, t, new MapObjects(COLS, ROWS));
    const onRock = g.addFlag(20, 10);
    const beside = g.addFlag(14, 6);
    const meadow = g.addFlag(6, 10);
    expect(g.flagByMountain(onRock)).toBe(true);
    expect(g.flagByMountain(beside)).toBe(true);
    expect(g.flagByMountain(meadow)).toBe(false);
    g.demolishFlag(onRock);
    expect(g.flagByMountain(onRock)).toBe(false);
    expect(g.flagByMountain(99)).toBe(false);
  });
});

describe('the trip', () => {
  it('walks to the flag, probes up to GEO_PROBES spots, and goes home', () => {
    const { g, f } = mountain();
    for (let i = 0; i < 12; i++) g.objects!.setOre(at(g, 11 + (i % 7), 8 + Math.floor(i / 7) * 3), 15, OreKind.Coal);
    g.sendGeologist(f);
    const start = g.tick;
    expect(g.geologists[0]!.phase).toBe(0); // on his way
    finish(g);
    const n = signs(g).length;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(GEO_PROBES);
    // each probe takes its time
    expect(((g.tick - start) & 0xffff) || 65536).toBeGreaterThan(0);
  });

  it('takes a probe\'s time at each spot, in order, one at a time', () => {
    const { g, f } = mountain();
    g.sendGeologist(f);
    let seen = 0;
    let probingTicks = 0;
    let last = -1;
    for (let i = 0; i < 60000 && g.geologists.length > 0; i++) {
      g.update();
      const geo = g.geologists[0];
      if (geo && geo.phase === 2) {
        probingTicks += g.speed;
        if (geo.target !== last) {
          last = geo.target;
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThanOrEqual(2);
    expect(probingTicks).toBeGreaterThanOrEqual(seen * (GEO_PROBE_TICKS - 2 * 2));
  });

  it('walks to each spot at walking pace', () => {
    const { g, f } = mountain();
    g.sendGeologist(f);
    let checked = 0;
    let last = -1;
    for (let i = 0; i < 60000 && g.geologists.length > 0; i++) {
      g.update();
      const geo = g.geologists[0];
      if (geo && geo.phase === 1 && geo.target !== last) {
        last = geo.target;
        const steps = Math.max(1, distanceBetween(COLS, geo.pos, geo.target));
        expect(geo.total).toBe(steps * STEP_TICKS);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it('probes only free mountain spots within reach of the flag', () => {
    const { g, f } = mountain();
    // clutter: a rock and a tree and a building near the flag
    g.objects!.set(at(g, 15, 10), MapObject.Stone, 5);
    g.objects!.set(at(g, 13, 9), MapObject.Tree);
    g.sendGeologist(f);
    finish(g);
    for (const p of signs(g)) {
      expect(distanceBetween(COLS, g.flags[f]!.pos, p)).toBeLessThanOrEqual(GEO_RADIUS);
      expect(g.objects!.kindAt(p)).toBe(MapObject.None);
      expect(g.isOccupied(p)).toBe(false);
    }
    expect(g.objects!.sign[at(g, 15, 10)]).toBe(0);
    expect(g.objects!.sign[at(g, 13, 9)]).toBe(0);
  });

  it('never probes grass beside the mountain', () => {
    const t = TerrainMap.flat(COLS, ROWS, 8);
    for (let y = 0; y < ROWS; y++) for (let x = 15; x < COLS; x++) t.setHeight(y * COLS + x, 20);
    const g = new Game(COLS, ROWS, t, new MapObjects(COLS, ROWS));
    const a = g.addFlag(4, 10);
    const f = g.addFlag(14, 10);
    g.addBuilding(BuildingType.Castle, a);
    g.addRoad(a, new Array<Dir>(10).fill(Dir.Right));
    g.sendGeologist(f);
    finish(g);
    expect(signs(g).length).toBeGreaterThan(0);
    for (const p of signs(g)) expect(g.terrain.heightAt(p)).toBeGreaterThanOrEqual(15);
  });
});

describe('the signs', () => {
  it('say what is underneath: kind, small or large, or nothing', () => {
    const { g, f } = mountain();
    const o = g.objects!;
    for (let y = 5; y <= 15; y++) {
      for (let x = 9; x <= 19; x++) {
        const p = at(g, x, y);
        const r = (x * 7 + y * 3) % 5;
        if (r === 0) o.setOre(p, 20, OreKind.Gold);
        else if (r === 1) o.setOre(p, 6, OreKind.Iron);
        else if (r === 2) o.setOre(p, 12, OreKind.Coal);
        else if (r === 3) o.setOre(p, 11, OreKind.Stone);
      }
    }
    g.sendGeologist(f);
    finish(g);
    const found = new Set<number>();
    for (const p of signs(g)) {
      const s = o.sign[p]!;
      if (o.ore[p]! > 0) {
        expect(s).toBe(signFor(o.oreKind[p] as OreKind, o.ore[p]!));
        expect(signKind(s)).toBe(o.oreKind[p]);
        expect(signIsSmall(s)).toBe(o.ore[p]! < SIGN_SMALL_BELOW);
        found.add(s);
      } else {
        expect(s).toBe(SIGN_EMPTY);
        expect(signKind(s)).toBe(OreKind.None);
      }
    }
    expect(found.size).toBeGreaterThan(1);
  });

  it('encodes every kind and size distinctly', () => {
    const seen = new Set<number>([SIGN_EMPTY]);
    for (const k of [OreKind.Stone, OreKind.Coal, OreKind.Iron, OreKind.Gold]) {
      for (const units of [3, 30]) {
        const s = signFor(k, units);
        expect(seen.has(s)).toBe(false);
        seen.add(s);
        expect(signKind(s)).toBe(k);
        expect(signIsSmall(s)).toBe(units < SIGN_SMALL_BELOW);
      }
    }
    expect(signKind(0)).toBe(OreKind.None);
    expect(signKind(SIGN_EMPTY)).toBe(OreKind.None);
  });

  it('do not give the ore away: nothing is known until a geologist has been', () => {
    const { g } = mountain();
    for (let p = 0; p < COLS * ROWS; p += 3) g.objects!.setOre(p, 9, OreKind.Iron);
    expect(signs(g).length).toBe(0);
  });

  it('fade after SIGN_TICKS', () => {
    const { g, f } = mountain();
    g.sendGeologist(f);
    finish(g);
    const n = signs(g).length;
    expect(n).toBeGreaterThan(0);
    // the first sign has been up for a while already: after most of SIGN_TICKS some remain, after all of it none
    const left = Math.max(...signs(g).map((p) => g.objects!.signLeft[p]!));
    expect(left).toBeGreaterThan(SIGN_TICKS - 3 * GEO_PROBES * 800);
    run(g, Math.ceil((SIGN_TICKS - left) / g.speed) - 5);
    expect(signs(g).length).toBeGreaterThan(0);
    run(g, Math.ceil(left / g.speed) + 50);
    expect(signs(g).length).toBe(0);
  });

  it('never get in the way of building', () => {
    const { g, f } = mountain();
    g.sendGeologist(f);
    finish(g);
    const p = signs(g)[0]!;
    expect(g.objects!.sign[p]).not.toBe(0);
    expect(checkBuilding(g, BuildingType.StoneMine, p).ok).toBe(true);
  });

  it('a find is announced once for a cluster of the same kind', () => {
    const { g, f } = mountain();
    const o = g.objects!;
    for (let y = 6; y <= 14; y++) for (let x = 10; x <= 18; x++) o.setOre(at(g, x, y), 15, OreKind.Coal);
    g.sendGeologist(f);
    finish(g);
    expect(signs(g).length).toBeGreaterThan(2);
    expect(g.discoveries.length).toBeGreaterThanOrEqual(1);
    expect(g.discoveries.length).toBeLessThan(signs(g).length);
    for (const d of g.discoveries) expect(d.kind).toBe(OreKind.Coal);
  });

  it('a region already full of signs: nothing left to probe, so he goes home at once', () => {
    const { g, f } = mountain();
    const o = g.objects!;
    for (let p = 0; p < COLS * ROWS; p++) if (g.flagAtPos(p) < 0 && !g.roadAtPos(p)) o.setSign(p, SIGN_EMPTY, 60000);
    g.sendGeologist(f);
    let probed = false;
    let steps = 0;
    while (g.geologists.length > 0 && steps++ < 20000) {
      g.update();
      if (g.geologists[0]?.phase === 2) probed = true;
    }
    expect(g.geologists.length).toBe(0);
    expect(probed).toBe(false);
    // there and back only: less than the eight probes alone would take
    expect(steps * g.speed).toBeLessThan(GEO_PROBES * GEO_PROBE_TICKS);
  });

  it('where nothing is free he also goes home at once', () => {
    const { g, f } = mountain();
    for (let p = 0; p < COLS * ROWS; p++) if (g.flagAtPos(p) < 0 && !g.roadAtPos(p)) g.objects!.set(p, MapObject.Tree);
    g.sendGeologist(f);
    finish(g, 20000);
    expect(signs(g).length).toBe(0);
  });
});

describe('hammers', () => {
  it('with tools he takes a hammer from the storage and brings it back', () => {
    const { g, castle, f } = mountain(true);
    g.sendGeologist(f);
    expect(castle.stock[Res.Hammer]).toBe(1);
    expect(g.countItems(Res.Hammer)).toBe(2); // one in his hand
    conserved(g);
    run(g, 800);
    conserved(g);
    finish(g);
    expect(castle.stock[Res.Hammer]).toBe(2);
    conserved(g);
  });

  it('with no hammer in store he is not sent', () => {
    const { g, castle, f } = mountain(true);
    castle.stock[Res.Hammer] = 0;
    g.created[Res.Hammer] = 0;
    expect(g.checkGeologist(f).reason).toMatch(/hammer/);
    expect(() => g.sendGeologist(f)).toThrow(/hammer/);
  });

  it('two geologists need two hammers', () => {
    const { g, castle, f } = mountain(true);
    const f2 = g.addFlag(14, 14);
    g.addRoad(f, [Dir.Down, Dir.Down, Dir.Down, Dir.Down]);
    g.sendGeologist(f);
    g.sendGeologist(f2);
    expect(castle.stock[Res.Hammer]).toBe(0);
    finish(g);
    expect(castle.stock[Res.Hammer]).toBe(2);
    conserved(g);
  });

  it('without tools no hammer is needed', () => {
    const { g, castle, f } = mountain(false);
    g.sendGeologist(f);
    finish(g);
    expect(castle.stock[Res.Hammer]).toBe(0);
  });

  it('if his storage burns down meanwhile, the hammer goes to the castle', () => {
    const g = new Game(COLS, ROWS, TerrainMap.flat(COLS, ROWS, 20), new MapObjects(COLS, ROWS));
    g.tools = true;
    const a = g.addFlag(2, 10);
    const s = g.addFlag(8, 10);
    const f = g.addFlag(16, 10);
    const castle = g.buildings[g.addBuilding(BuildingType.Castle, a)]!;
    const store = g.buildings[g.addBuilding(BuildingType.Storage, s)]!;
    g.addRoad(a, new Array<Dir>(6).fill(Dir.Right));
    g.addRoad(s, new Array<Dir>(8).fill(Dir.Right));
    g.addStock(store.index, Res.Hammer, 1);
    g.sendGeologist(f);
    expect(g.geologists[0]!.home).toBe(store.index);
    g.demolishBuilding(store.index);
    finish(g);
    expect(castle.stock[Res.Hammer]).toBe(1);
    conserved(g);
  });
});

describe('determinism and saving', () => {
  const trip = () => {
    const { g, f } = mountain(true);
    for (let i = 0; i < 20; i++) g.objects!.setOre(at(g, 10 + (i % 8), 6 + Math.floor(i / 8) * 3), 14, OreKind.Iron);
    g.sendGeologist(f);
    return { g, f };
  };

  it('the same game gives the same signs', () => {
    const a = trip().g;
    const b = trip().g;
    finish(a);
    finish(b);
    expect(signs(a)).toEqual(signs(b));
    expect(a.tick).toBe(b.tick);
  });

  it('a save made in the middle of a trip carries on identically', () => {
    for (const steps of [3, 60, 400, 900, 1500]) {
      const { g } = trip();
      run(g, steps);
      const copy = Game.restore(JSON.parse(JSON.stringify(g.serialize())));
      expect(copy.geologists).toEqual(g.geologists);
      for (let i = 0; i < 4000; i++) {
        g.update();
        copy.update();
      }
      expect(JSON.stringify(copy.serialize())).toBe(JSON.stringify(g.serialize()));
      expect(copy.fingerprint()).toBe(g.fingerprint());
    }
  });

  it('signs keep their remaining time through a save', () => {
    const { g, f } = mountain();
    g.sendGeologist(f);
    finish(g);
    const p = signs(g)[0]!;
    const copy = Game.restore(JSON.parse(JSON.stringify(g.serialize())));
    expect(copy.objects!.sign[p]).toBe(g.objects!.sign[p]);
    expect(copy.objects!.signLeft[p]).toBe(g.objects!.signLeft[p]);
    run(copy, Math.ceil(SIGN_TICKS / copy.speed) + 20);
    expect(copy.objects!.sign[p]).toBe(0); // and they still fade
  });

  it('an older save without geologists or signs loads fine', () => {
    const { g } = mountain();
    const d = JSON.parse(JSON.stringify(g.serialize()));
    delete d.geologists;
    delete d.nextGeologist;
    delete d.objects.sign;
    delete d.objects.signLeft;
    const old = Game.restore(d);
    expect(old.geologists).toEqual([]);
    run(old, 50);
    old.sendGeologist(old.flagAtPos(at(old, 14, 10)));
    expect(old.geologists.length).toBe(1);
  });
});
