// The command layer the player drives through the tools, without a browser.
import { describe, expect, it } from 'vitest';
import { App } from '../src/app.ts';

/** A new game with the castle flag at (25,21) and a second flag four steps east. */
function setup(): App {
  const app = new App('new');
  app.setTool('flag');
  app.click(29, 21);
  app.setTool('road');
  app.click(25, 21);
  app.click(29, 21);
  return app;
}

describe('flags on roads', () => {
  it('the Flag tool cuts a road at the clicked point', () => {
    const app = setup();
    const g = app.game;
    expect(g.roads.length).toBe(1);
    app.setTool('flag');
    app.click(27, 21);
    expect(g.roads.length).toBe(2);
    expect(g.flags.length).toBe(3);
    expect(g.roads.map((r) => r.length)).toEqual([2, 2]);
    expect(app.toast).toBe('');
  });

  it('the Road tool does it in one click and starts a branch from there', () => {
    const app = setup();
    const g = app.game;
    app.setTool('flag');
    app.click(27, 25); // where the branch will end
    app.setTool('road');
    app.click(27, 21); // a point on the road: flag placed, branch started
    expect(g.roads.length).toBe(2);
    expect(app.roadStart).toBe(g.flagAtPos(g.index(27, 21)));
    app.click(27, 25);
    expect(g.roads.length).toBe(3); // the branch exists
    expect(app.roadStart).toBe(-1);
    const branch = g.roads[2]!;
    expect(g.flags[branch.flag[0]]!.pos).toBe(g.index(27, 21));
    expect(g.flags[branch.flag[1]]!.pos).toBe(g.index(27, 25));
  });

  it('a branch can also end on a point of a road', () => {
    const app = setup();
    const g = app.game;
    app.setTool('flag');
    app.click(27, 25);
    app.setTool('road');
    app.click(27, 25); // start at the lone flag
    app.click(27, 21); // end on the road: cut it and connect
    expect(g.roads.length).toBe(3);
    expect(g.flags.length).toBe(4);
  });

  it('refuses, with a reason, where a flag would crowd another', () => {
    const app = setup();
    const g = app.game;
    app.setTool('road');
    app.click(26, 21); // next to the castle flag at (25,21)
    expect(g.roads.length).toBe(1);
    expect(g.flags.length).toBe(2);
    expect(app.toast).toContain('too close to another flag');
    expect(app.roadStart).toBe(-1);
  });

  it('says what a click on bare ground does with the road tool', () => {
    const app = setup();
    app.setTool('road');
    app.click(33, 25);
    expect(app.toast).toContain('click a flag');
  });

  it('describes the hovered road point for the tools', () => {
    const app = setup();
    app.hover = { x: 27, y: 21 };
    app.setTool('road');
    expect(app.hoverInfo()).toContain('click to put a flag here and branch off');
    app.setTool('flag');
    expect(app.hoverInfo()).toContain('cuts this road in two');
    app.hover = { x: 26, y: 21 };
    expect(app.hoverInfo()).toContain('too close to another flag');
  });
});
