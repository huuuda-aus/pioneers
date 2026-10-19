// The client side of geologists: the tool, what hovering says, the news of a
// find, and that the ore itself is no longer shown anywhere.
import { describe, expect, it } from 'vitest';
import { BuildingType, Dir, Game, MapObjects, OreKind, Res, TerrainMap, signFor } from '@sett/sim';
import { App } from '../src/app.ts';
import { ORE_COLOR } from '../src/palette.ts';

const COLS = 32;
const ROWS = 22;

/** An app on a mountain plateau: a castle at the left, a flag out on the rock joined by road. */
function rock(): { app: App; g: Game; flag: number; x: number; y: number } {
  const app = new App('new');
  const g = new Game(COLS, ROWS, TerrainMap.flat(COLS, ROWS, 20), new MapObjects(COLS, ROWS));
  g.tools = true;
  g.settlers = true;
  const a = g.addFlag(4, 10);
  const f = g.addFlag(14, 10);
  const castle = g.buildings[g.addBuilding(BuildingType.Castle, a)]!;
  g.addStock(castle.index, Res.Hammer, 2);
  g.addRoad(a, new Array<Dir>(10).fill(Dir.Right));
  app.game = g;
  return { app, g, flag: f, x: 14, y: 10 };
}

describe('the geologist tool', () => {
  it('sends a geologist to the flag clicked', () => {
    const { app, g, x, y } = rock();
    app.setTool('geologist');
    app.click(x, y);
    expect(g.geologists.length).toBe(1);
    expect(app.toast).toMatch(/geologist is on his way/i);
  });

  it('says why not when it cannot, and sends nobody', () => {
    const { app, g, x, y } = rock();
    app.setTool('geologist');
    app.click(x + 3, y + 3); // not a flag
    expect(g.geologists.length).toBe(0);
    expect(app.toast).toMatch(/click a flag/i);
    app.click(x, y);
    app.click(x, y); // a second one to the same flag
    expect(g.geologists.length).toBe(1);
    expect(app.toast).toMatch(/already working/);
  });

  it('hovering a flag says whether he can go', () => {
    const { app, x, y } = rock();
    app.setTool('geologist');
    app.hover = { x, y };
    expect(app.hoverInfo()).toMatch(/click to send a geologist/);
    app.hover = { x: x + 2, y };
    expect(app.hoverInfo()).toMatch(/goes to a flag/);
    app.click(x, y);
    app.setTool('geologist');
    app.hover = { x, y };
    expect(app.hoverInfo()).toMatch(/already working/);
  });

  it('a find is announced once', () => {
    const { app, g, x, y } = rock();
    for (let yy = 6; yy <= 14; yy++) for (let xx = 10; xx <= 18; xx++) g.objects!.setOre(g.index(xx, yy), 15, OreKind.Gold);
    app.setTool('geologist');
    app.click(x, y);
    let said = '';
    for (let i = 0; i < 30000 && g.geologists.length > 0; i++) {
      app.frame(20);
      if (app.toast.includes('found')) said = app.toast;
    }
    expect(said).toMatch(/found gold/);
    expect(g.discoveries.length).toBe(0); // read and cleared
  });
});

describe('the ore stays hidden', () => {
  it('hovering a spot with ore says nothing about it, hovering a sign does', () => {
    const { app, g, x, y } = rock();
    const p = g.index(x + 2, y + 1);
    g.objects!.setOre(p, 20, OreKind.Coal);
    app.hover = { x: x + 2, y: y + 1 };
    expect(app.hoverInfo()).not.toMatch(/coal|ore/i);
    g.objects!.setSign(p, signFor(OreKind.Coal, 20));
    expect(app.hoverInfo()).toMatch(/sign: plenty of coal/);
    g.objects!.setSign(p, signFor(OreKind.Iron, 4));
    expect(app.hoverInfo()).toMatch(/sign: a little iron/);
    g.objects!.setSign(p, 1);
    expect(app.hoverInfo()).toMatch(/nothing found/);
  });

  it('every kind of ore has its own sign colour', () => {
    const colours = [OreKind.Stone, OreKind.Coal, OreKind.Iron, OreKind.Gold].map((k) => ORE_COLOR[k]);
    expect(new Set(colours).size).toBe(4);
  });
});
