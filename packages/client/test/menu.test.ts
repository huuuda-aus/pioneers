// The main screen: nothing runs or is saved behind it, Continue needs a game,
// New game replaces the saved one.
import { describe, expect, it } from 'vitest';
import { App } from '../src/app.ts';
import { SAVE_KEY, type KV } from '../src/persistence.ts';

class Mem implements KV {
  data = new Map<string, string>();
  writes = 0;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.writes++;
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const play = (app: App, ms: number) => {
  for (let t = 0; t < ms; t += 16) app.frame(16);
};

function menuApp(store: KV | null) {
  const app = new App('new', store);
  app.screen = 'menu';
  return app;
}

describe('main screen', () => {
  it('a first visit has nothing to continue', () => {
    const app = menuApp(new Mem());
    expect(app.canContinue).toBe(false);
    app.continueGame();
    expect(app.screen).toBe('menu');
  });

  it('new game starts a fresh game and leaves the menu', () => {
    const store = new Mem();
    const app = menuApp(store);
    app.newGame();
    expect(app.screen).toBe('game');
    expect(app.game.tick).toBe(0);
    expect(store.data.has(SAVE_KEY)).toBe(true); // written at once
  });

  it('nothing runs or is saved while the menu is up', () => {
    const store = new Mem();
    const app = menuApp(store);
    play(app, 2000);
    expect(app.game.tick).toBe(0);
    expect(store.writes).toBe(0);
  });

  it('continue brings back the saved game, as it was', () => {
    const store = new Mem();
    const a = new App('new', store);
    play(a, 3000);
    a.openMenu();
    const tick = a.game.tick;
    expect(tick).toBeGreaterThan(0);
    expect(a.screen).toBe('menu');
    play(a, 2000);
    expect(a.game.tick).toBe(tick); // frozen behind the menu

    const b = menuApp(store); // a new visit
    expect(b.canContinue).toBe(true);
    b.continueGame();
    expect(b.screen).toBe('game');
    expect(b.game.tick).toBe(tick);
    play(b, 500);
    expect(b.game.tick).toBeGreaterThan(tick);
  });

  it('new game replaces the saved one', () => {
    const store = new Mem();
    const a = new App('new', store);
    play(a, 3000);
    a.openMenu();
    const old = store.getItem(SAVE_KEY);
    const b = menuApp(store);
    b.newGame();
    expect(b.game.tick).toBe(0);
    expect(store.getItem(SAVE_KEY)).not.toBe(old);
  });

  it('without storage, a game begun this session can be returned to', () => {
    const app = menuApp(null);
    app.newGame();
    play(app, 1000);
    app.openMenu();
    expect(app.canContinue).toBe(true);
    const tick = app.game.tick;
    app.continueGame();
    expect(app.game.tick).toBe(tick);
    expect(app.screen).toBe('game');
  });

  it('a damaged save leaves Continue off and says why', () => {
    const store = new Mem();
    store.data.set(SAVE_KEY, '{nope');
    const app = menuApp(store);
    expect(app.canContinue).toBe(false);
    expect(app.toast).toMatch(/could not be loaded/);
  });
});

describe('older saves', () => {
  it('a save made before workers walked in still gets the walk (and spare carriers go home)', () => {
    const store = new Mem();
    const a = new App('new', store);
    a.saveNow();
    const env = JSON.parse(store.getItem(SAVE_KEY)!);
    delete env.game.settlers; // as an old save has it
    store.setItem(SAVE_KEY, JSON.stringify(env));
    const b = new App('new', store);
    expect(b.game.settlers).toBe(true);
  });
});
