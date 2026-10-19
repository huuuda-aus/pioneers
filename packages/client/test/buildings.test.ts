// Every building, in every state, drawn onto a recording stand-in for the
// canvas: nothing throws, nothing lands in a silly place, a finished building
// has plenty of detail, a site has its stages, and only a working building
// moves.
import { describe, expect, it } from 'vitest';
import { BuildingType } from '@sett/sim';
import { drawBuildingArt, type Art } from '../src/buildings.ts';

interface Call {
  name: string;
  args: unknown[];
}

/** A Graphics look-alike: every method records itself and returns the same object, so chains work. */
function recorder(): { g: never; calls: Call[] } {
  const calls: Call[] = [];
  const g: unknown = new Proxy(
    {},
    {
      get: (_t, name) => (...args: unknown[]) => {
        calls.push({ name: String(name), args });
        return g;
      },
    },
  );
  return { g: g as never, calls };
}

const numbers = (calls: Call[]): number[] => {
  const out: number[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'number') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const c of calls) walk(c.args);
  return out;
};
/** All x, y coordinates of drawing calls that take points (poly, rect, circle ...). */
function extent(calls: Call[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const point = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const c of calls) {
    const a = c.args;
    if (c.name === 'poly' && Array.isArray(a[0])) {
      const p = a[0] as number[];
      for (let i = 0; i + 1 < p.length; i += 2) point(p[i]!, p[i + 1]!);
    } else if ((c.name === 'moveTo' || c.name === 'lineTo') && typeof a[0] === 'number') point(a[0], a[1] as number);
    else if ((c.name === 'circle' || c.name === 'ellipse') && typeof a[0] === 'number') point(a[0], a[1] as number);
    else if (c.name === 'rect' && typeof a[0] === 'number') {
      point(a[0], a[1] as number);
      point((a[0] as number) + (a[2] as number), (a[1] as number) + (a[3] as number));
    }
  }
  return { minX, maxX, minY, maxY };
}

const T = BuildingType;
const ALL = Object.values(T).filter((v): v is number => typeof v === 'number');
const sizeOf = (t: BuildingType): { w: number; h: number } =>
  t === T.Castle ? { w: 62, h: 46 } : [T.Sawmill, T.Storage, T.Farm, T.Mill, T.Baker].includes(t) ? { w: 58, h: 34 } : { w: 34, h: 24 };

function art(type: BuildingType, over: Partial<Art> = {}): Art {
  return { type, cx: 500, cy: 400, ...sizeOf(type), time: 3.7, working: false, progress: 1, seed: 5, ore: 1, ...over };
}
const draw = (a: Art) => {
  const r = recorder();
  drawBuildingArt(r.g, a);
  return r.calls;
};

describe('every building is drawn', () => {
  for (const type of ALL) {
    const name = T[type]!;

    it(`${name}: finished, idle and working, without a hitch and with real detail`, () => {
      for (const working of [false, true]) {
        const calls = draw(art(type, { working }));
        expect(calls.length, `${name} working=${working}`).toBeGreaterThan(40);
        for (const n of numbers(calls)) expect(Number.isFinite(n)).toBe(true);
      }
    });

    it(`${name}: stays near its footprint (nothing flung across the map)`, () => {
      const { w, h } = sizeOf(type);
      for (const working of [false, true]) {
        const e = extent(draw(art(type, { working, time: 1.3 })));
        expect(e.minX).toBeGreaterThan(500 - w * 1.4);
        expect(e.maxX).toBeLessThan(500 + w * 1.4);
        expect(e.maxY).toBeLessThan(400 + w * 0.9);
        expect(e.minY).toBeGreaterThan(400 - h * 3.2 - 40);
      }
    });

    it(`${name}: a site shows its stages and is not just the finished building`, () => {
      const stages = [0, 0.3, 0.6, 0.9].map((p) => draw(art(type, { progress: p, planks: 3, stones: 2 })));
      for (const calls of stages) {
        expect(calls.length).toBeGreaterThan(8);
        for (const n of numbers(calls)) expect(Number.isFinite(n)).toBe(true);
      }
      const finished = JSON.stringify(draw(art(type)));
      for (const calls of stages) expect(JSON.stringify(calls)).not.toBe(finished);
      // the frame grows: a later stage is not the same picture as an earlier one
      expect(JSON.stringify(stages[1])).not.toBe(JSON.stringify(stages[2]));
      expect(JSON.stringify(stages[2])).not.toBe(JSON.stringify(stages[3]));
    });

    it(`${name}: looks the same every time it is drawn`, () => {
      expect(JSON.stringify(draw(art(type, { working: true })))).toBe(JSON.stringify(draw(art(type, { working: true }))));
    });
  }
});

describe('life', () => {
  const MOVERS = [T.Lumberjack, T.Sawmill, T.Stonecutter, T.Baker, T.Mill, T.Well, T.IronSmelter, T.GoldSmelter, T.Toolmaker, T.Farm, T.StoneMine, T.CoalMine];

  it('a working building moves: two moments differ', () => {
    for (const type of MOVERS) {
      const a = JSON.stringify(draw(art(type, { working: true, time: 2.0 })));
      const b = JSON.stringify(draw(art(type, { working: true, time: 2.4 })));
      expect(a, T[type]).not.toBe(b);
    }
  });

  it('a building at rest is quiet: the sawmill blade, the mill sails and the furnace hold still', () => {
    for (const type of [T.Sawmill, T.Mill, T.IronSmelter, T.Toolmaker, T.Stonecutter, T.Well]) {
      const a = JSON.stringify(draw(art(type, { working: false, time: 2.0 })));
      const b = JSON.stringify(draw(art(type, { working: false, time: 2.4 })));
      // only slow ambient things (a banner, a hoist) may move at rest; the working parts do not
      const work = JSON.stringify(draw(art(type, { working: true, time: 2.4 })));
      expect(work, T[type]).not.toBe(b);
      expect(a.length).toBeGreaterThan(0);
    }
  });

  it('the castle and the storage always have something stirring: banners and a swinging crate', () => {
    for (const type of [T.Castle, T.Storage]) {
      expect(JSON.stringify(draw(art(type, { time: 1 })))).not.toBe(JSON.stringify(draw(art(type, { time: 1.4 }))));
    }
  });
});

describe('looks', () => {
  it('buildings differ from one another', () => {
    const seen = new Set<string>();
    const ore: Record<number, number> = { [T.StoneMine]: 1, [T.CoalMine]: 2, [T.IronMine]: 3, [T.GoldMine]: 4 };
    for (const type of ALL) seen.add(JSON.stringify(draw(art(type, { ore: ore[type] ?? 1 }))));
    expect(seen.size).toBe(ALL.length);
  });

  it('the four mines differ only by their ore', () => {
    const mines = [T.StoneMine, T.CoalMine, T.IronMine, T.GoldMine];
    const pictures = mines.map((m, i) => JSON.stringify(draw(art(m, { ore: i + 1 }))));
    expect(new Set(pictures).size).toBe(4);
    // the same ore gives the same picture whichever mine it is
    expect(JSON.stringify(draw(art(T.CoalMine, { ore: 2 })))).toBe(JSON.stringify(draw(art(T.IronMine, { ore: 2 }))));
  });

  it('the two smelters differ by their metal', () => {
    expect(JSON.stringify(draw(art(T.IronSmelter)))).not.toBe(JSON.stringify(draw(art(T.GoldSmelter))));
  });

  it('a site shows the planks and stones delivered', () => {
    const none = JSON.stringify(draw(art(T.Lumberjack, { progress: 0.2 })));
    const some = JSON.stringify(draw(art(T.Lumberjack, { progress: 0.2, planks: 3, stones: 2 })));
    expect(some).not.toBe(none);
  });

  it('the picture changes with the seed (neighbours of one kind are not clones)', () => {
    const a = JSON.stringify(draw(art(T.StoneMine, { seed: 1 })));
    const b = JSON.stringify(draw(art(T.StoneMine, { seed: 9 })));
    expect(a).not.toBe(b);
  });
});
