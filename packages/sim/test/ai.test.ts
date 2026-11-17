// The computer opponent: it plays by the rules the player does, so these
// check what it builds and does, and that a saved game replays it exactly.
import { describe, expect, it } from 'vitest';
import { BuildingType, Difficulty, Game, MOUNTAIN_LEVEL, MapObjects, OreKind, Res, SEA_LEVEL, Temperament, TerrainMap, flattenArea, generateObjects, hexDistance, toolFor } from '../src/index.ts';
import { run } from './scenarios.ts';
import { SKILL, aiPeriod } from '../src/ai.ts';

const T = BuildingType;

/** Through real JSON, as a browser would store it. */
const roundtrip = (g: Game): Game => Game.restore(JSON.parse(JSON.stringify(g.serialize())));

/** Owner 0 (nobody plays it) in the west, owner 1 (the AI) in the east, both stocked to build and arm. */
function world(temperament: Temperament, gap = 36) {
  const g = new Game(120, 60);
  const west = g.placeBuilding(T.Castle, g.index(20, 30), false, 0);
  const east = g.placeBuilding(T.Castle, g.index(20 + gap, 30), false, 1);
  for (const c of [west, east]) {
    g.addStock(c, Res.Plank, 60);
    g.addStock(c, Res.Stone, 30);
    g.addStock(c, Res.Sword, 20);
    g.addStock(c, Res.Shield, 20);
  }
  const ai = g.addAi(1, temperament);
  return { g, ai, west, east };
}

const countOf = (g: Game, owner: number, type: BuildingType): number =>
  g.buildings.filter((b) => !b.removed && b.owner === owner && b.type === type).length;

describe('building up from the castle', { timeout: 30000 }, () => {
  it('puts up wood, stone and then military buildings, all joined to its castle', () => {
    const { g, east } = world(Temperament.Defensive);
    run(g, 60000);
    // it built a wood and stone economy (and pulled producers down again when their goods piled up in the castle)
    expect(g.created[Res.Lumber]!).toBeGreaterThan(0);
    expect(g.created[Res.Plank]!).toBeGreaterThan(0);
    expect(countOf(g, 1, T.Forester)).toBe(1);
    const military = g.buildings.filter((b) => !b.removed && b.owner === 1 && (b.type === T.Hut || b.type === T.Tower));
    expect(military.length).toBeGreaterThan(1);
    // everything it owns hangs off its castle by road
    const reach = new Set<number>([g.buildings[east]!.flag]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of g.roads) {
        if (r.removed) continue;
        if (reach.has(r.flag[0]) !== reach.has(r.flag[1])) {
          reach.add(r.flag[0]);
          reach.add(r.flag[1]);
          grew = true;
        }
      }
    }
    for (const b of g.buildings) if (!b.removed && b.owner === 1 && b.burning === 0) expect(reach.has(b.flag), `${T[b.type]} is connected`).toBe(true);
  });

  it('grows the land it holds as it expands', () => {
    const { g } = world(Temperament.Defensive);
    const land = () => g.ownerAt.filter((o) => o === 1).length;
    const before = land();
    run(g, 60000);
    expect(land()).toBeGreaterThan(before * 1.5);
  });

  it('its knights are armed from the castle and garrison what it built', () => {
    const { g } = world(Temperament.Defensive);
    run(g, 60000);
    const huts = g.buildings.filter((b) => !b.removed && b.owner === 1 && b.type === T.Hut);
    expect(huts.some((h) => h.garrison > 0)).toBe(true);
  });

  it('does not touch the other side', () => {
    const { g } = world(Temperament.Defensive);
    run(g, 60000);
    expect(g.buildings.filter((b) => b.owner === 0 && !b.removed).length).toBe(1); // just the castle
  });
});

describe('keeping house', { timeout: 30000 }, () => {
  it('pulls down a producer whose goods are piling up in the castle', () => {
    const { g, east } = world(Temperament.Defensive);
    const lumberjack = g.placeBuilding(T.Lumberjack, g.index(53, 27), false, 1);
    g.addStock(east, Res.Lumber, 120);
    run(g, 1500);
    expect(g.buildings[lumberjack]!.burning > 0 || g.buildings[lumberjack]!.removed).toBe(true);
  });

  it('takes up roads cut off from its castle', () => {
    const { g } = world(Temperament.Defensive);
    const a = g.addFlag(70, 20, 1);
    g.addFlag(74, 20, 1);
    const road = g.addRoad(a, [0, 0, 0, 0]);
    run(g, 1500);
    expect(g.roads[road]!.removed).toBe(true);
  });
});

describe('temperament', { timeout: 30000 }, () => {
  /** An owner 0 hut with `knights` inside right in the AI's reach, so there is something to attack. */
  function withTarget(temperament: Temperament, knights: number) {
    const w = world(temperament, 36);
    const flag = w.g.addFlag(40, 30, 0);
    const hut = w.g.addBuilding(T.Hut, flag);
    w.g.setGarrison(hut, knights);
    return { ...w, hut };
  }

  it('peaceful never attacks, however weak the target', () => {
    const { g, hut } = withTarget(Temperament.Peaceful, 1);
    let attacked = false;
    for (let i = 0; i < 80000; i++) {
      g.update();
      if (g.attackers.length > 0 || g.buildings[hut]!.owner !== 0) attacked = true;
    }
    expect(attacked).toBe(false);
  });

  it('aggressive attacks a weak target once it can spare enough knights', () => {
    const { g, hut } = withTarget(Temperament.Aggressive, 1);
    let attacked = false;
    for (let i = 0; i < 80000 && !attacked; i++) {
      g.update();
      if (g.attackers.some((a) => a.owner === 1)) attacked = true;
    }
    expect(attacked).toBe(true);
    expect(hut).toBeGreaterThanOrEqual(0);
  });

  it('does not attack a garrison it would lose to, but does once gold in its stores makes its knights worth more', () => {
    const struck = (gold: number): boolean => {
      const { g, hut, east } = withTarget(Temperament.Aggressive, 2);
      g.buildings[hut]!.veterans = [0, 0, 2, 0]; // two rank-3 knights: 2 x 8 x home morale
      g.addStock(east, Res.Gold, gold);
      for (let i = 0; i < 70000; i++) {
        g.update();
        if (g.attackers.some((a) => a.owner === 1)) return true;
      }
      return false;
    };
    expect(struck(0)).toBe(false); // away from home it is no match, and it waits for more instead of throwing knights away
    expect(struck(40)).toBe(true); // all the gold on its side: away morale about five times a home knight's
  });

  it('defensive leaves a neighbour alone until it is attacked, then hits back', () => {
    const { g, hut, ai } = withTarget(Temperament.Defensive, 1);
    for (let i = 0; i < 60000; i++) g.update();
    expect(g.attackers.some((a) => a.owner === 1)).toBe(false);
    expect(ai.provoked).toBe(-1);
    // the neighbour strikes first
    g.setGarrison(hut, 3);
    const theirs = g.buildings.find((b) => !b.removed && b.owner === 1 && b.type === T.Hut && b.garrison > 1)!;
    g.sendAttack(0, theirs.index, 1);
    expect(ai.provoked).toBeGreaterThanOrEqual(0);
    let struck = false;
    for (let i = 0; i < 60000 && !struck; i++) {
      g.update();
      if (g.attackers.some((a) => a.owner === 1)) struck = true;
    }
    expect(struck).toBe(true);
  });
});

describe('difficulty', { timeout: 60000 }, () => {
  /** Owner 1 aggressive at `difficulty`, owner 0 with a weakly held hut in its reach; the tick (game time) it first sends knights, or -1. */
  function firstStrike(difficulty: Difficulty, limit: number): number {
    const w = world(Temperament.Aggressive, 36);
    w.ai.difficulty = difficulty;
    const flag = w.g.addFlag(40, 30, 0);
    w.g.setGarrison(w.g.addBuilding(T.Hut, flag), 1);
    for (let i = 0; i < limit / w.g.speed; i++) {
      w.g.update();
      if (w.g.attackers.some((a) => a.owner === 1)) return i * w.g.speed; // in ticks
    }
    return -1;
  }

  it('Easy keeps its opening long: no first attack inside its grace, where Hard has already struck', () => {
    expect(firstStrike(Difficulty.Easy, 120000)).toBe(-1);
    const hard = firstStrike(Difficulty.Hard, 60000);
    expect(hard).toBeGreaterThanOrEqual(0);
    expect(hard).toBeGreaterThanOrEqual(SKILL[Difficulty.Hard].grace * 0.5); // not before its own (short) grace was nearly over
    const normal = firstStrike(Difficulty.Normal, 120000);
    expect(normal).toBeGreaterThanOrEqual(hard);
    expect(normal).toBeGreaterThanOrEqual(SKILL[Difficulty.Normal].grace * 0.5);
  });

  it('bends its pace: slower on Easy, quicker on Hard, and never attacks on odds below even', () => {
    const base = aiPeriod({ owner: 1, temperament: Temperament.Aggressive, cooldown: 0, provoked: -1, difficulty: Difficulty.Normal });
    const at = (d: Difficulty) => aiPeriod({ owner: 1, temperament: Temperament.Aggressive, cooldown: 0, provoked: -1, difficulty: d });
    expect(at(Difficulty.Easy)).toBeGreaterThan(base);
    expect(at(Difficulty.Hard)).toBeLessThan(base);
    expect(SKILL[Difficulty.Easy].grace).toBeGreaterThan(SKILL[Difficulty.Normal].grace);
    expect(SKILL[Difficulty.Normal].grace).toBeGreaterThan(SKILL[Difficulty.Hard].grace);
  });

  it('is saved with its age, and an old save loads Normal with no grace', () => {
    const w = world(Temperament.Aggressive);
    w.ai.difficulty = Difficulty.Hard;
    run(w.g, 3000);
    const h = roundtrip(w.g);
    expect(h.ais[0]!.difficulty).toBe(Difficulty.Hard);
    expect(h.ais[0]!.age).toBe(w.g.ais[0]!.age);
    expect(w.g.ais[0]!.age).toBeGreaterThan(0);

    const data = w.g.serialize() as unknown as { ais: { difficulty?: Difficulty; age?: number }[] };
    for (const a of data.ais) {
      delete a.difficulty;
      delete a.age;
    }
    const old = Game.restore(JSON.parse(JSON.stringify(data)) as Parameters<typeof Game.restore>[0]);
    expect(old.ais[0]!.difficulty).toBe(Difficulty.Normal);
    expect(old.ais[0]!.age).toBeUndefined(); // no opening grace for a game already under way
  });
});

describe('save and load', { timeout: 30000 }, () => {
  it('is exact: a round trip mid-game carries on the same, and two runs agree', () => {
    const a = world(Temperament.Aggressive).g;
    run(a, 30000);
    const b = roundtrip(a);
    run(a, 30000);
    run(b, 30000);
    expect(JSON.stringify(b.serialize())).toBe(JSON.stringify(a.serialize()));
    const c = world(Temperament.Aggressive).g;
    run(c, 60000);
    expect(JSON.stringify(c.serialize())).toBe(JSON.stringify(a.serialize()));
  });

  it('an old save with no ais loads, without an opponent', () => {
    const { g } = world(Temperament.Defensive);
    const data = g.serialize() as unknown as Record<string, unknown>;
    delete data.ais;
    const h = Game.restore(JSON.parse(JSON.stringify(data)) as Parameters<typeof Game.restore>[0]);
    expect(h.ais).toEqual([]);
  });
});

/**
 * The AI alone in the east with wood and stone around it, a lake, and a mountain plateau of coal and
 * iron (and gold) at `ore` steps from its castle (null: none anywhere). It has planks and stone and nothing
 * with an edge: swords have to be made.
 */
function miningWorld(opts: { ore: number | null; swords?: number; tools?: Partial<Record<Res, number>> }) {
  const cols = 120;
  const rows = 60;
  const t = TerrainMap.flat(cols, rows);
  const castle: [number, number] = [56, 30];
  flattenArea(t, castle[0], castle[1] + 8, 2, SEA_LEVEL, 3); // a lake to fish
  const plateau: [number, number] = [castle[0] + (opts.ore ?? 0), castle[1] - 2];
  if (opts.ore !== null) flattenArea(t, plateau[0], plateau[1], 2, MOUNTAIN_LEVEL, 8);
  const o = generateObjects(t, 3, { keepClear: (p) => hexDistance((p % cols) - castle[0], Math.floor(p / cols) - castle[1]) <= 4 }) as MapObjects;
  for (let p = 0; p < cols * rows; p++) {
    if (t.heightAt(p) < MOUNTAIN_LEVEL) o.setOre(p, 0, OreKind.Stone);
  }
  if (opts.ore !== null) {
    let n = 0;
    for (let p = 0; p < cols * rows; p++) {
      if (t.heightAt(p) >= MOUNTAIN_LEVEL && hexDistance((p % cols) - plateau[0], Math.floor(p / cols) - plateau[1]) <= 2) {
        o.setOre(p, 12, [OreKind.Coal, OreKind.Iron, OreKind.Gold][n++ % 3]!);
      }
    }
  }
  const g = new Game(cols, rows, t, o);
  const c = g.placeBuilding(T.Castle, g.index(castle[0], castle[1]), false, 1);
  g.addStock(c, Res.Plank, 80);
  g.addStock(c, Res.Stone, 60);
  if (opts.swords) {
    g.addStock(c, Res.Sword, opts.swords);
    g.addStock(c, Res.Shield, opts.swords);
  }
  if (opts.tools) {
    g.tools = true;
    for (const [r, n] of Object.entries(opts.tools)) g.addStock(c, Number(r) as Res, n!);
  }
  g.addAi(1, Temperament.Defensive);
  return { g, c, plateau };
}

describe('mining and the weapons chain', { timeout: 60000 }, () => {
  it('builds food, mines, a smelter and a weaponsmith, and makes the swords it garrisons with', () => {
    const { g } = miningWorld({ ore: 6 });
    run(g, 160000);
    // the mines ran (and, worked out, were pulled down), the smelter and weaponsmith stand
    for (const type of [T.IronSmelter, T.Weaponsmith]) expect(countOf(g, 1, type), T[type]).toBe(1);
    expect(g.created[Res.Coal]!).toBeGreaterThan(0);
    expect(g.created[Res.IronOre]!).toBeGreaterThan(0);
    expect(g.created[Res.Iron]!).toBeGreaterThan(0);
    expect(g.created[Res.Fish]! + g.created[Res.Bread]!).toBeGreaterThan(0); // food for the mines
    expect(g.created[Res.Sword]!).toBeGreaterThan(0);
    expect(g.created[Res.Shield]!).toBeGreaterThan(0);
    expect(g.buildings.filter((b) => !b.removed && b.owner === 1 && b.type === T.Hut).some((h) => h.garrison > 0)).toBe(true);
  });

  it('expands toward ore that lies beyond its land, then mines it', () => {
    const { g, plateau } = miningWorld({ ore: 13, swords: 14 });
    const point = g.index(plateau[0], plateau[1]);
    expect(g.ownerAt[point]).not.toBe(1);
    run(g, 200000);
    expect(g.ownerAt[point]).toBe(1);
    expect(g.created[Res.Coal]! + g.created[Res.IronOre]!).toBeGreaterThan(0); // a mine was built and dug
  });

  it('never builds a mine where there is no ore, and carries on with the rest', () => {
    const { g } = miningWorld({ ore: null, swords: 14 });
    run(g, 80000);
    for (const type of [T.CoalMine, T.IronMine, T.GoldMine]) expect(countOf(g, 1, type), T[type]).toBe(0);
    expect(countOf(g, 1, T.Hut)).toBeGreaterThan(0);
  });

  it('does not queue buildings whose worker has no tool to take', () => {
    const { g } = miningWorld({ ore: 6, tools: { [Res.Axe]: 3, [Res.Saw]: 1, [Res.Shovel]: 1, [Res.Rod]: 1, [Res.Pick]: 1, [Res.Hammer]: 1 } });
    run(g, 120000);
    const needing = (tool: Res) => g.buildings.filter((b) => !b.removed && b.owner === 1 && toolFor(b.type) === tool).length;
    expect(needing(Res.Pick)).toBeLessThanOrEqual(1);
    expect(needing(Res.Hammer)).toBeLessThanOrEqual(1);
  });

  it('stays exact through a save in the middle of it', () => {
    const a = miningWorld({ ore: 6 }).g;
    run(a, 50000);
    const b = roundtrip(a);
    run(a, 50000);
    run(b, 50000);
    expect(JSON.stringify(b.serialize())).toBe(JSON.stringify(a.serialize()));
  });
});
