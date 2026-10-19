// Saving to browser storage: when it happens, what comes back, and what
// happens when the stored data or the storage itself misbehaves.
import { describe, expect, it } from 'vitest';
import { App, SAVE_DEBOUNCE_MS, SAVE_PERIOD_MS, STEP_MS } from '../src/app.ts';
import { BROKEN_KEY, SAVE_KEY, browserStorage, type KV } from '../src/persistence.ts';

class FakeStorage implements KV {
  data = new Map<string, string>();
  writes = 0;
  failWith: Error | null = null;
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.failWith) throw this.failWith;
    this.writes++;
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

/** Advance the app by `ms` of real time in frame-sized bites. */
function play(app: App, ms: number, frame = 16): void {
  for (let t = 0; t < ms; t += frame) app.frame(frame);
}

const place = (app: App) => {
  app.setTool('flag');
  app.click(29, 21);
};

describe('loading', () => {
  it('without storage the game just plays', () => {
    const app = new App('new', null);
    place(app);
    play(app, 20_000);
    expect(app.lastSaved).toBeNull();
  });

  it('with nothing saved, starts the requested scenario', () => {
    const app = new App('demo', new FakeStorage());
    expect(app.game.buildings.length).toBeGreaterThan(1);
    expect(app.lastSaved).toBeNull();
  });

  it('brings the saved game back exactly, and it keeps running', () => {
    const store = new FakeStorage();
    const a = new App('new', store);
    place(a);
    a.setTool('road');
    a.click(25, 21);
    a.click(29, 21);
    a.setSpeed(4);
    play(a, 3000);
    a.saveNow();

    const b = new App('new', store);
    expect(JSON.stringify(b.game.serialize())).toBe(JSON.stringify(a.game.serialize()));
    expect(b.game.flags.length).toBe(a.game.flags.length);
    expect(b.game.speed).toBe(4);
    expect(b.toast).toMatch(/Continued/);
    expect(b.lastSaved).not.toBeNull();
    const tick = b.game.tick;
    play(b, 1000);
    expect(b.game.tick).not.toBe(tick);
  });

  it('a game saved while paused comes back paused, and resumes at normal speed', () => {
    const store = new FakeStorage();
    const a = new App('new', store);
    a.togglePause();
    a.saveNow();
    const b = new App('new', store);
    expect(b.game.speed).toBe(0);
    b.togglePause();
    expect(b.game.speed).toBe(2);
  });

  it('an unreadable save is set aside and a new game starts, with the reason shown', () => {
    for (const bad of ['{not json', JSON.stringify({ format: 99, savedAt: 1, game: {} }), JSON.stringify({ format: 1, savedAt: 1, game: { version: 1, cols: 3 } }), 'null']) {
      const store = new FakeStorage();
      store.data.set(SAVE_KEY, bad);
      const app = new App('new', store);
      expect(app.game.buildings.length).toBe(1); // a fresh castle-only game
      expect(app.toast).toMatch(/could not be loaded/);
      expect(store.data.get(BROKEN_KEY)).toBe(bad); // kept, not lost
      expect(store.data.has(SAVE_KEY)).toBe(false);
    }
  });

  it('storage that throws on read is the same as no save', () => {
    const store = new FakeStorage();
    store.getItem = () => {
      throw new Error('blocked');
    };
    const app = new App('new', store);
    expect(app.game.buildings.length).toBe(1);
  });

  it('browserStorage is null where there is no usable localStorage', () => {
    expect(browserStorage()).toBeNull(); // the tests run without a window
  });
});

describe('when it saves', () => {
  it('shortly after a command, once for a burst of them', () => {
    const store = new FakeStorage();
    const app = new App('new', store);
    app.setSpeed(0); // isolate from the periodic save
    store.writes = 0;
    app.setTool('flag');
    app.click(29, 21);
    app.click(31, 21);
    app.click(33, 21);
    play(app, SAVE_DEBOUNCE_MS - 100);
    expect(store.writes).toBe(0); // still waiting for the burst to end
    play(app, 200);
    expect(store.writes).toBe(1);
    play(app, 5000);
    expect(store.writes).toBe(1); // nothing new to save while paused
    expect(JSON.parse(store.data.get(SAVE_KEY)!).game.flags.length).toBe(app.game.flags.length);
    expect(app.game.flags.length).toBeGreaterThan(2); // the clicks did place flags
  });

  it('Select-tool clicks (looking around) do not cause a write', () => {
    const store = new FakeStorage();
    const app = new App('new', store);
    app.setSpeed(0);
    app.saveNow();
    store.writes = 0;
    app.setTool('select');
    app.click(25, 21);
    app.click(10, 10);
    play(app, 5000);
    expect(store.writes).toBe(0);
  });

  it('every SAVE_PERIOD_MS while the game runs, even with no commands', () => {
    const store = new FakeStorage();
    const app = new App('new', store);
    store.writes = 0;
    play(app, SAVE_PERIOD_MS - 500);
    expect(store.writes).toBe(0);
    play(app, 1000);
    expect(store.writes).toBe(1);
    play(app, SAVE_PERIOD_MS);
    expect(store.writes).toBe(2);
    // what was written is the live game as it was a moment ago
    const saved = JSON.parse(store.data.get(SAVE_KEY)!).game.tick;
    expect(saved).toBeGreaterThan(0);
    expect(saved).toBeLessThanOrEqual(app.game.tick);
  });

  it('not periodically while paused', () => {
    const store = new FakeStorage();
    const app = new App('new', store);
    app.setSpeed(0);
    app.saveNow();
    store.writes = 0;
    play(app, SAVE_PERIOD_MS * 3);
    expect(store.writes).toBe(0);
  });

  it('on demand, at once (page hidden or closed)', () => {
    const store = new FakeStorage();
    const app = new App('new', store);
    store.writes = 0;
    place(app);
    app.saveNow();
    expect(store.writes).toBe(1);
    expect(JSON.parse(store.data.get(SAVE_KEY)!).game.flags.length).toBe(2);
  });

  it('starting a new game replaces the save at once', () => {
    const store = new FakeStorage();
    const a = new App('new', store);
    place(a);
    a.saveNow();
    a.loadScenario('demo');
    const b = new App('new', store);
    expect(b.game.buildings.length).toBe(a.game.buildings.length); // the demo colony, not the old game
    expect(b.game.buildings.length).toBeGreaterThan(1);
  });

  it('a step of the loop is still 50 Hz: saving does not change the timing', () => {
    const store = new FakeStorage();
    const a = new App('new', store);
    const b = new App('new', null);
    play(a, 5000, STEP_MS);
    play(b, 5000, STEP_MS);
    expect(a.game.tick).toBe(b.game.tick);
    expect(a.game.fingerprint()).toBe(b.game.fingerprint());
  });
});

describe('when saving fails', () => {
  it('tells the player once, keeps playing, and says when it works again', () => {
    const store = new FakeStorage();
    const app = new App('new', store);
    store.failWith = new Error('QuotaExceededError');
    app.saveNow();
    expect(app.toast).toMatch(/Could not save.*QuotaExceededError/);
    app.say('');
    app.saveNow();
    app.saveNow();
    expect(app.toast).toBe(''); // not repeated
    play(app, 1000);
    expect(app.game.tick).toBeGreaterThan(0); // the game goes on
    store.failWith = null;
    app.saveNow();
    expect(app.toast).toMatch(/works again/);
    expect(store.data.has(SAVE_KEY)).toBe(true);
  });

  it('a failed write leaves the previous good save untouched', () => {
    const store = new FakeStorage();
    const app = new App('new', store);
    app.saveNow();
    const good = store.data.get(SAVE_KEY);
    place(app);
    store.failWith = new Error('full');
    app.saveNow();
    expect(store.data.get(SAVE_KEY)).toBe(good);
  });
});
