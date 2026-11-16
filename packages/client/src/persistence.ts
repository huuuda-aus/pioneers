// Keeping the game between visits: one slot in browser storage, written as the
// game is played and read when the page opens. The storage is passed in, so
// tests use a fake one and a browser with storage blocked just plays unsaved.

import { Game, type SaveData } from '@sett/sim';

/** The slice of the Storage interface that saving needs. */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SAVE_KEY = 'sett.save';
/** A save that would not load is kept here instead of being thrown away. */
export const BROKEN_KEY = 'sett.save.broken';
const FORMAT = 1;

interface Envelope {
  format: number;
  savedAt: number;
  game: SaveData;
}

/** The browser's localStorage, or null where it is missing or blocked. */
export function browserStorage(): KV | null {
  try {
    const s = window.localStorage;
    const probe = '__sett_probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function makeEnvelope(game: Game, now: number): Envelope {
  return { format: FORMAT, savedAt: now, game: game.serialize() };
}

export function writeSave(store: KV, game: Game, now: number): void {
  store.setItem(SAVE_KEY, JSON.stringify(makeEnvelope(game, now)));
}

/** The save as JSON text, for the player to download. */
export function exportSave(game: Game, now: number): string {
  return JSON.stringify(makeEnvelope(game, now), null, 2);
}

export type LoadResult =
  | { kind: 'none' }
  | { kind: 'loaded'; game: Game; savedAt: number }
  | { kind: 'broken'; reason: string };

function parseEnvelope(text: string): LoadResult {
  try {
    const env = JSON.parse(text) as Envelope;
    if (!env || env.format !== FORMAT || typeof env.savedAt !== 'number') throw new Error('not a saved game of this version');
    return { kind: 'loaded', game: Game.restore(env.game), savedAt: env.savedAt };
  } catch (e) {
    return { kind: 'broken', reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Read the slot. A save that cannot be understood is moved aside, not deleted. */
export function readSave(store: KV): LoadResult {
  let text: string | null;
  try {
    text = store.getItem(SAVE_KEY);
  } catch {
    return { kind: 'none' };
  }
  if (text === null) return { kind: 'none' };
  const result = parseEnvelope(text);
  if (result.kind === 'broken') {
    try {
      store.setItem(BROKEN_KEY, text);
      store.removeItem(SAVE_KEY);
    } catch {
      /* nothing more can be done */
    }
  }
  return result;
}

/** Parse a save file the player picked (uploaded, not from this browser's slot). */
export function importSave(text: string): LoadResult {
  return parseEnvelope(text);
}

export function clearSave(store: KV): void {
  try {
    store.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}
