// The Demolish tool: what a click removes, what it refuses, and what is left.
import { describe, expect, it } from 'vitest';
import { BuildingType } from '@sett/sim';
import { App } from '../src/app.ts';

/** Castle flag (25,21); a flag at (29,21) joined by a road, a flag at (27,21) cutting it. */
function setup(): App {
  const app = new App('new');
  app.setTool('flag');
  app.click(29, 21);
  app.setTool('road');
  app.click(25, 21);
  app.click(29, 21);
  app.setTool('flag');
  app.click(27, 21);
  app.setTool('demolish');
  return app;
}

describe('the Demolish tool', () => {
  it('a click on a flag in the middle of a road joins the roads again', () => {
    const app = setup();
    const g = app.game;
    expect(g.roads.filter((r) => !r.removed).length).toBe(2);
    app.click(27, 21);
    expect(g.roads.filter((r) => !r.removed).length).toBe(1);
    expect(g.flagAtPos(g.index(27, 21))).toBe(-1);
    expect(g.roadAtPos(g.index(27, 21))).toBe(true);
    expect(app.toast).toBe('');
  });

  it('a click on a road point removes that road', () => {
    const app = setup();
    const g = app.game;
    app.click(26, 21);
    expect(g.roads.filter((r) => !r.removed).length).toBe(1);
    expect(g.roadAtPos(g.index(26, 21))).toBe(false);
  });

  it('refuses the castle, says why, and changes nothing', () => {
    const app = setup();
    const g = app.game;
    const layout = g.layoutVersion;
    app.click(g.buildings[g.castle]!.pos % g.cols, Math.floor(g.buildings[g.castle]!.pos / g.cols));
    expect(app.toast).toMatch(/castle cannot be demolished/);
    expect(g.layoutVersion).toBe(layout);
    app.click(25, 21); // the castle's door flag: it has a building
    expect(app.toast).toMatch(/building stands at this flag/);
  });

  it('says so when there is nothing to demolish', () => {
    const app = setup();
    app.click(5, 5);
    expect(app.toast).toMatch(/Nothing to demolish/);
  });

  it('burns a building, and its door flag stays', () => {
    const app = setup();
    const g = app.game;
    app.setTool('lumberjack');
    const pos = g.index(29, 18);
    app.click(29, 18);
    const bi = g.buildingAtPos(pos);
    expect(bi).toBeGreaterThanOrEqual(0);
    const door = g.buildings[bi]!.flag;
    app.setTool('demolish');
    expect(app.hoverInfo()).toBe(''); // no hover set
    app.click(29, 18);
    expect(g.buildings[bi]!.burning).toBeGreaterThan(0);
    expect(g.flags[door]!.removed).toBe(false);
    expect(g.flags[door]!.building).toBe(-1);
    expect(g.buildings[bi]!.type).toBe(BuildingType.Lumberjack);
    app.click(29, 18); // again: already burning
    expect(app.toast).toMatch(/already burning/);
  });

  it('clears a selection that points at what was removed', () => {
    const app = setup();
    app.setTool('select');
    app.click(26, 21);
    expect(app.selection?.kind).toBe('road');
    app.setTool('demolish');
    app.click(26, 21);
    expect(app.selection).toBeNull();
    // selection of a road that merges away is dropped on the next frame
    const a2 = setup();
    a2.setTool('select');
    a2.click(28, 21);
    const sel = a2.selection!;
    expect(sel.kind).toBe('road');
    a2.setTool('demolish');
    a2.click(27, 21); // merge: the higher-index road disappears
    a2.frame(20);
    expect(a2.selection === null || a2.game.roads[a2.selection.index]!.removed === false).toBe(true);
  });
});
