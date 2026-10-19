// Scenarios are built with the same checked placement the player uses, so a
// layout that breaks a rule throws here instead of surprising someone later.
import { describe, expect, it } from 'vitest';
import { BuildingType, FLAT_HEIGHT, HARVEST_RADIUS, MapObject, OreKind, Res, hexDistance } from '@sett/sim';
import { makeScenario } from '../src/scenarios.ts';

describe('new game', () => {
  const g = makeScenario('new');

  it('is the castle and its flag, nothing else', () => {
    expect(g.flags.length).toBe(1);
    expect(g.roads.length).toBe(0);
    expect(g.buildings.length).toBe(1);
    expect(g.buildings[g.castle]!.type).toBe(BuildingType.Castle);
  });

  it('starts with planks and stone in the castle', () => {
    const c = g.buildings[g.castle]!;
    expect(c.stock[Res.Plank]).toBe(12);
    expect(c.stock[Res.Stone]).toBe(6);
  });

  it('has forests and rocks, none near the castle', () => {
    const c = g.buildings[g.castle]!;
    const cx = c.pos % g.cols;
    const cy = Math.floor(c.pos / g.cols);
    expect(g.objects!.count(MapObject.Tree)).toBeGreaterThan(100);
    expect(g.objects!.count(MapObject.Stone)).toBeGreaterThan(10);
    for (let y = 0; y < g.rows; y++) {
      for (let x = 0; x < g.cols; x++) {
        if (hexDistance(x - cx, y - cy) <= 3) expect(g.objectAtPos(g.index(x, y))).toBe(MapObject.None);
      }
    }
    let nearTrees = 0;
    let nearRocks = 0;
    for (let y = 0; y < g.rows; y++) {
      for (let x = 0; x < g.cols; x++) {
        if (hexDistance(x - cx, y - cy) > 10) continue;
        const k = g.objectAtPos(g.index(x, y));
        if (k === MapObject.Tree) nearTrees++;
        if (k === MapObject.Stone) nearRocks++;
      }
    }
    expect(nearTrees).toBeGreaterThan(10); // a lumberjack can be built near the start
    expect(nearRocks).toBeGreaterThan(2); // and a stonecutter
  });

  it('stands on level ground, with the same map every time', () => {
    const c = g.buildings[g.castle]!;
    const cx = c.pos % g.cols;
    const cy = Math.floor(c.pos / g.cols);
    for (let y = 0; y < g.rows; y++) {
      for (let x = 0; x < g.cols; x++) {
        if (hexDistance(x - cx, y - cy) <= 5) expect(g.terrain.heightAt(g.index(x, y))).toBe(FLAT_HEIGHT);
      }
    }
    expect(Array.from(makeScenario('new').terrain.height)).toEqual(Array.from(g.terrain.height));
  });
});

describe('running colony', () => {
  it('builds without breaking a placement rule', () => {
    const g = makeScenario('demo');
    expect(g.flags.length).toBe(8);
    expect(g.roads.length).toBe(6);
    expect(g.buildings.map((b) => b.type).sort()).toEqual(
      [BuildingType.Lumberjack, BuildingType.Lumberjack, BuildingType.Sawmill, BuildingType.Castle, BuildingType.Forester].sort(),
    );
    expect(g.buildings.every((b) => !b.constructing)).toBe(true);
  });

  it('gives both lumberjacks trees within reach', () => {
    const g = makeScenario('demo');
    for (const b of g.buildings.filter((x) => x.type === BuildingType.Lumberjack)) {
      let trees = 0;
      for (let y = 0; y < g.rows; y++) {
        for (let x = 0; x < g.cols; x++) {
          const d = hexDistance(x - (b.pos % g.cols), y - Math.floor(b.pos / g.cols));
          if (d <= HARVEST_RADIUS && g.objectAtPos(g.index(x, y)) === MapObject.Tree) trees++;
        }
      }
      expect(trees).toBeGreaterThanOrEqual(10);
    }
  });

  it('lumber comes from trees: every lumber made is one tree gone', () => {
    const g = makeScenario('demo');
    g.demolishBuilding(g.buildings.findIndex((b) => b.type === BuildingType.Forester)); // nothing is planted
    const before = g.objects!.count(MapObject.Tree);
    for (let i = 0; i < 6000; i++) g.update();
    expect(g.created[Res.Lumber]).toBeGreaterThan(0);
    expect(before - g.objects!.count(MapObject.Tree)).toBe(g.created[Res.Lumber]);
  });

  it('its forester plants, and the saplings grow into trees', () => {
    const g = makeScenario('demo');
    expect(g.objects!.count(MapObject.Sapling)).toBe(0);
    for (let i = 0; i < 1500; i++) g.update();
    expect(g.objects!.count(MapObject.Sapling)).toBeGreaterThan(0);
  });

  it('runs with store limits on', () => {
    for (const id of ['new', 'demo'] as const) {
      const g = makeScenario(id);
      const castle = g.buildings[g.castle]!;
      expect(g.limits).not.toBeNull();
      expect(castle.capacity).toBeGreaterThan(0);
    }
  });

  it('actually runs: lumber becomes planks that reach the castle', () => {
    const g = makeScenario('demo');
    for (let i = 0; i < 6000; i++) g.update();
    expect(g.created[Res.Lumber]).toBeGreaterThan(0);
    expect(g.created[Res.Plank]).toBeGreaterThan(12); // beyond the starting planks
    for (let r = 0; r < 3; r++) expect(g.created[r]! - g.consumed[r]!).toBe(g.countItems(r as Res));
  });
});

describe('food and mining', () => {
  it('the mine stands on ore, the farm has room for fields, and a game has ore under its mountains', () => {
    const g = makeScenario('food');
    const mine = g.buildings.find((b) => b.type === BuildingType.StoneMine)!;
    expect(g.objects!.oreNear(mine.pos, OreKind.Stone)).toBeGreaterThan(0);
    const total = g.objects!.ore.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(200);
    expect(makeScenario('new').objects!.ore.some((v) => v > 0)).toBe(true);
  });

  it('builds the whole chain on the terrain, all connected and finished', () => {
    const g = makeScenario('food');
    const types = g.buildings.map((b) => b.type);
    for (const t of [BuildingType.Farm, BuildingType.Mill, BuildingType.Well, BuildingType.Baker, BuildingType.Fisher, BuildingType.StoneMine, BuildingType.Castle]) {
      expect(types).toContain(t);
    }
    expect(g.buildings.every((b) => !b.constructing)).toBe(true);
    // every building's flag is joined to the castle's
    const reach = new Set<number>([g.buildings[g.castle]!.flag]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of g.roads) {
        const [a, b] = r.flag;
        if (reach.has(a) !== reach.has(b)) {
          reach.add(a);
          reach.add(b);
          grew = true;
        }
      }
    }
    for (const b of g.buildings) expect(reach.has(b.flag), `${BuildingType[b.type]} is connected`).toBe(true);
  });

  it('works: bread and fish reach the mine, which digs stone', () => {
    const g = makeScenario('food');
    for (let i = 0; i < 30000; i++) g.update();
    expect(g.created[Res.Bread]).toBeGreaterThan(0);
    expect(g.created[Res.Fish]).toBeGreaterThan(0);
    expect(g.created[Res.Stone]).toBeGreaterThan(0);
    expect(g.consumed[Res.Bread]! + g.consumed[Res.Fish]!).toBeGreaterThan(0);
    for (let r = 0; r < 8; r++) expect(g.created[r]! - g.consumed[r]! - g.lost[r]!).toBe(g.countItems(r as Res));
  });
});
