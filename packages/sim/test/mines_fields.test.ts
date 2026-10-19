// Finite ore under the mountains, and farm fields that are sown, ripen and are cut.
import { describe, expect, it } from 'vitest';
import {
  BState,
  BuildingType,
  FIELD_RADIUS,
  FIELD_TICKS,
  Game,
  MAX_FIELDS,
  MapObject,
  MapObjects,
  ORE_RADIUS,
  Res,
  SCAN_TICKS,
  TerrainMap,
  checkBuilding,
  generateObjects,
  generateTerrain,
} from '../src/index.ts';
import * as sc from './scenarios.ts';

const T = BuildingType;
const COLS = 28;
const ROWS = 20;
const at = (g: Game, x: number, y: number) => g.index(x, y);
const grass = (): Game => new Game(COLS, ROWS, undefined, new MapObjects(COLS, ROWS));
const rock = (): Game => new Game(COLS, ROWS, TerrainMap.flat(COLS, ROWS, 20), new MapObjects(COLS, ROWS));
const objs = (g: Game): MapObjects => g.objects!;
const oreTotal = (g: Game): number => objs(g).ore.reduce((a, b) => a + b, 0);
const kinds = (g: Game, k: MapObject): number => objs(g).count(k);

describe('ore', () => {
  it('a mine digs ore as it makes stone, one unit each', () => {
    const g = rock();
    const p = at(g, 10, 8);
    objs(g).setOre(at(g, 11, 8), 9);
    const mine = g.buildings[g.placeBuilding(T.StoneMine, p, false)]!;
    mine.stock[Res.Fish] = 4;
    sc.run(g, 4000);
    expect(g.created[Res.Stone]).toBe(4);
    expect(oreTotal(g)).toBe(9 - 4);
    expect(mine.stock[Res.Fish]).toBe(0);
  });

  it('when the ore is gone it stops, and keeps the food it has', () => {
    const g = rock();
    objs(g).setOre(at(g, 10, 9), 3);
    const mine = g.buildings[g.placeBuilding(T.StoneMine, at(g, 10, 8), false)]!;
    mine.stock[Res.Bread] = 10;
    sc.run(g, 8000);
    expect(g.created[Res.Stone]).toBe(3);
    expect(mine.state).toBe(BState.NoResource);
    expect(mine.stock[Res.Bread]).toBe(7);
    expect(oreTotal(g)).toBe(0);
    sc.run(g, 4000); // it does not come back
    expect(g.created[Res.Stone]).toBe(3);
  });

  it('digs the nearest ore first, and only within reach', () => {
    const g = rock();
    const near = at(g, 11, 8);
    const far = at(g, 10 + ORE_RADIUS, 8);
    const out = at(g, 10 + ORE_RADIUS + 1, 8);
    objs(g).setOre(near, 1);
    objs(g).setOre(far, 5);
    objs(g).setOre(out, 5);
    const mine = g.buildings[g.placeBuilding(T.StoneMine, at(g, 10, 8), false)]!;
    mine.stock[Res.Fish] = 2;
    sc.run(g, 4000);
    expect(objs(g).ore[near]).toBe(0);
    expect(objs(g).ore[far]).toBe(4);
    expect(objs(g).ore[out]).toBe(5);
  });

  it('with no ore at all it does not eat', () => {
    const g = rock();
    objs(g).setOre(at(g, 11, 8), 1);
    const mine = g.buildings[g.placeBuilding(T.StoneMine, at(g, 10, 8), false)]!;
    objs(g).setOre(at(g, 11, 8), 0);
    mine.stock[Res.Fish] = 3;
    sc.run(g, 2000);
    expect(mine.state).toBe(BState.NoResource);
    expect(mine.stock[Res.Fish]).toBe(3);
    expect(g.consumed[Res.Fish]).toBe(0);
  });

  it('two mines share a vein', () => {
    const g = rock();
    objs(g).setOre(at(g, 12, 8), 6);
    const a = g.buildings[g.placeBuilding(T.StoneMine, at(g, 10, 8), false)]!;
    const b = g.buildings[g.placeBuilding(T.StoneMine, at(g, 14, 8), false)]!;
    a.stock[Res.Fish] = 10;
    b.stock[Res.Fish] = 10;
    sc.run(g, 10000);
    expect(g.created[Res.Stone]).toBe(6);
    expect(oreTotal(g)).toBe(0);
  });

  it('a mine may be placed anywhere on a mountain: whether there is ore is for a geologist to say', () => {
    const g = rock();
    expect(checkBuilding(g, T.StoneMine, at(g, 10, 8)).ok).toBe(true); // no ore anywhere
    const grass = new Game(COLS, ROWS, undefined, new MapObjects(COLS, ROWS));
    expect(checkBuilding(grass, T.StoneMine, at(grass, 10, 8)).reason).toMatch(/mines go on mountains/);
  });

  it('a generated map has ore only under mountains, a fixed share, the same each time', () => {
    const t = generateTerrain({ cols: 48, rows: 40, seed: 7 });
    const a = generateObjects(t, 7);
    const b = generateObjects(t, 7);
    expect(Array.from(a.ore)).toEqual(Array.from(b.ore));
    let mountain = 0;
    let withOre = 0;
    for (let p = 0; p < 48 * 40; p++) {
      const isMountain = t.heightAt(p) >= 15;
      if (isMountain) mountain++;
      if (a.ore[p]! > 0) {
        withOre++;
        expect(isMountain).toBe(true);
      }
    }
    expect(withOre).toBeGreaterThan(mountain * 0.3);
    expect(withOre).toBeLessThan(mountain * 0.6);
    const c = generateObjects(t, 8);
    expect(Array.from(c.ore)).not.toEqual(Array.from(a.ore));
  });
});

describe('fields', () => {
  const farmAt = (g: Game, x = 10, y = 8) => g.buildings[g.placeBuilding(T.Farm, at(g, x, y), false)]!;

  it('a farm sows first: no wheat until a field has ripened and been cut', () => {
    const g = grass();
    farmAt(g);
    sc.run(g, 700); // the first trip, out and back
    expect(kinds(g, MapObject.Field)).toBeGreaterThan(0);
    expect(g.created[Res.Wheat]).toBe(0);
    sc.run(g, (FIELD_TICKS / g.speed) * 0.5);
    expect(g.created[Res.Wheat]).toBe(0); // not ripe yet
    sc.run(g, FIELD_TICKS / g.speed + 1600);
    expect(g.created[Res.Wheat]).toBeGreaterThan(0);
  });

  it('a field takes exactly its time to ripen', () => {
    const g = grass();
    objs(g).plant(at(g, 5, 5), 100, MapObject.Field);
    expect(objs(g).kindAt(at(g, 5, 5))).toBe(MapObject.Field);
    sc.run(g, 49);
    expect(objs(g).kindAt(at(g, 5, 5))).toBe(MapObject.Field);
    sc.run(g, 1);
    expect(objs(g).kindAt(at(g, 5, 5))).toBe(MapObject.Wheat);
  });

  it('cutting a ripe field gives one wheat and clears the ground', () => {
    const g = grass();
    const wheat = at(g, 11, 8);
    objs(g).set(wheat, MapObject.Wheat);
    farmAt(g);
    sc.run(g, 1500);
    expect(g.created[Res.Wheat]).toBeGreaterThanOrEqual(1);
    expect(objs(g).kindAt(wheat)).not.toBe(MapObject.Wheat);
  });

  it('stays within reach and never has more than MAX_FIELDS', () => {
    const g = grass();
    const farm = farmAt(g);
    let most = 0;
    for (let i = 0; i < 400; i++) {
      sc.run(g, 100);
      most = Math.max(most, kinds(g, MapObject.Field) + kinds(g, MapObject.Wheat));
      if (i % 50 === 0) {
        for (let p = 0; p < COLS * ROWS; p++) {
          const k = objs(g).kindAt(p);
          if (k === MapObject.Field || k === MapObject.Wheat) {
            const d = Math.max(Math.abs((p % COLS) - 10), Math.abs(Math.floor(p / COLS) - 8), Math.abs((p % COLS) - 10 - (Math.floor(p / COLS) - 8)));
            expect(d).toBeLessThanOrEqual(FIELD_RADIUS);
          }
        }
      }
    }
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(MAX_FIELDS);
    expect(farm.removed).toBe(false);
  });

  it('with MAX_FIELDS already growing it sows no more, and waits', () => {
    const g = grass();
    for (let i = 0; i < MAX_FIELDS; i++) objs(g).plant(at(g, 8 + i, 10), 60000, MapObject.Field);
    const farm = farmAt(g);
    sc.run(g, 1500);
    expect(kinds(g, MapObject.Field)).toBe(MAX_FIELDS);
    expect(farm.state).toBe(BState.NoResource);
    objs(g).remove(at(g, 8, 10)); // room for one again
    sc.run(g, 1500);
    expect(kinds(g, MapObject.Field)).toBe(MAX_FIELDS);
  });

  it('fields block building, and a lumberjack ignores them', () => {
    const g = grass();
    objs(g).plant(at(g, 15, 5), 5000, MapObject.Field);
    objs(g).set(at(g, 18, 5), MapObject.Wheat);
    expect(checkBuilding(g, T.Lumberjack, at(g, 15, 5)).reason).toMatch(/field/);
    expect(checkBuilding(g, T.Lumberjack, at(g, 18, 5)).reason).toMatch(/field/);
    const lj = g.buildings[g.placeBuilding(T.Lumberjack, at(g, 16, 6), false)]!;
    sc.run(g, 400);
    expect(lj.state).toBe(BState.NoResource);
    expect(kinds(g, MapObject.Wheat)).toBe(1);
  });

  it('a farm with no room waits and looks again', () => {
    const g = grass();
    const farm = farmAt(g, 2, 2);
    for (let p = 0; p < COLS * ROWS; p++) if (g.buildingAtPos(p) < 0 && g.objects!.kindAt(p) === MapObject.None && p !== at(g, 2, 2)) objs(g).set(p, MapObject.Tree);
    sc.run(g, 10);
    expect(farm.state).toBe(BState.NoResource);
    expect(farm.counter).toBeLessThanOrEqual(SCAN_TICKS);
  });

  it('demolishing a farm frees the field it had claimed', () => {
    const g = grass();
    const farm = farmAt(g);
    sc.run(g, 20);
    expect(farm.target).toBeGreaterThanOrEqual(0);
    const claimed = farm.target;
    g.demolishBuilding(farm.index);
    expect(objs(g).reservedBy[claimed]).toBe(0);
  });

  it('without an object layer the farm still just makes wheat (the C++ model)', () => {
    const g = new Game(COLS, ROWS);
    g.placeBuilding(T.Farm, at(g, 10, 8), false);
    sc.run(g, 3000);
    expect(g.created[Res.Wheat]).toBeGreaterThan(0);
  });
});

describe('saving', () => {
  const rt = (g: Game) => Game.restore(JSON.parse(JSON.stringify(g.serialize())));

  it('ore and fields survive a save, and the copy carries on identically', () => {
    const g = new Game(COLS, ROWS, TerrainMap.flat(COLS, ROWS, 12), new MapObjects(COLS, ROWS));
    // a mountain strip on the right with ore, grass elsewhere
    for (let y = 0; y < ROWS; y++) for (let x = 18; x < COLS; x++) g.terrain.setHeight(at(g, x, y), 20);
    objs(g).setOre(at(g, 20, 8), 7);
    const mine = g.buildings[g.placeBuilding(T.StoneMine, at(g, 19, 8), false)]!;
    mine.stock[Res.Fish] = 5;
    g.placeBuilding(T.Farm, at(g, 6, 8), false);
    sc.run(g, 1800); // fields sown, some ore dug, a trip in progress
    expect(kinds(g, MapObject.Field)).toBeGreaterThan(0);
    expect(oreTotal(g)).toBeLessThan(7);
    const copy = rt(g);
    expect(Array.from(copy.objects!.ore)).toEqual(Array.from(g.objects!.ore));
    expect(kinds(copy, MapObject.Field)).toBe(kinds(g, MapObject.Field));
    sc.run(g, 4000);
    sc.run(copy, 4000);
    expect(JSON.stringify(copy.serialize())).toBe(JSON.stringify(g.serialize()));
    expect(kinds(g, MapObject.Wheat) + g.created[Res.Wheat]).toBeGreaterThan(0);
  });

  it('a save from before ore existed loads with no ore (and mines say so)', () => {
    const g = rock();
    objs(g).setOre(at(g, 11, 8), 4);
    const mine = g.buildings[g.placeBuilding(T.StoneMine, at(g, 10, 8), false)]!;
    mine.stock[Res.Fish] = 2;
    const d = JSON.parse(JSON.stringify(g.serialize()));
    delete d.objects.ore;
    const old = Game.restore(d);
    expect(oreTotal(old)).toBe(0);
    sc.run(old, 3000);
    expect(old.buildings[0]!.state).toBe(BState.NoResource);
  });
});
