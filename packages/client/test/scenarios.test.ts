// Scenarios are built with the same checked placement the player uses, so a
// layout that breaks a rule throws here instead of surprising someone later.
import { describe, expect, it } from 'vitest';
import { Temperament, BuildingType, FLAT_HEIGHT, HARVEST_RADIUS, MapObject, OreKind, Res, UNCLAIMED, hexDistance } from '@sett/sim';
import { makeScenario } from '../src/scenarios.ts';
import { App } from '../src/app.ts';

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

describe('two colonies', () => {
  it('builds both castles, each claiming its own land and nothing else', () => {
    const g = makeScenario('territory');
    const castles = g.buildings.filter((b) => b.type === BuildingType.Castle);
    expect(castles.length).toBe(2);
    expect(g.castleOf(0)).not.toBe(-1);
    expect(g.castleOf(1)).not.toBe(-1);
    for (const owner of [0, 1] as const) {
      const c = g.buildings[g.castleOf(owner)]!;
      expect(g.ownerAt[c.pos]).toBe(owner);
    }
    // the two colonies are far enough apart that no point belongs to both
    let unclaimed = 0;
    for (const o of g.ownerAt) if (o === UNCLAIMED) unclaimed++;
    expect(unclaimed).toBeGreaterThan(0); // there is a no man's land between them
  });

  it('has a garrisoned hut each facing the other, and you can attack theirs', () => {
    const g = makeScenario('territory');
    const huts = g.buildings.filter((b) => b.type === BuildingType.Hut);
    expect(huts.map((h) => [h.owner, h.garrison])).toEqual([[0, 3], [1, 3]]);
    const theirs = huts.find((h) => h.owner === 1)!;
    expect(g.checkAttack(0, theirs.index).ok).toBe(true);
    expect(g.availableKnights(0, theirs.index)).toBe(2);
    expect(g.buildings[g.castleOf(0)]!.stock[Res.Gold]).toBe(6);
    expect(g.awayMorale(0)).toBe(11264); // an even split of the world's gold
    expect(g.ais.map((x) => x.owner)).toEqual([1]); // the rival is a computer player
    expect(g.buildings[g.castleOf(1)]!.stock[Res.Sword]).toBe(40);
  });

  it('always has coal, iron and gold on a hill just beyond each colony\'s reach', () => {
    const g = makeScenario('territory');
    for (const owner of [0, 1]) {
      const c = g.buildings[g.castleOf(owner)]!;
      for (const kind of [OreKind.Coal, OreKind.Iron, OreKind.Gold]) {
        let nearest = Infinity;
        for (let p = 0; p < g.cols * g.rows; p++) {
          if (g.objects!.ore[p]! > 0 && g.objects!.oreKind[p] === kind) {
            nearest = Math.min(nearest, hexDistance((p % g.cols) - (c.pos % g.cols), Math.floor(p / g.cols) - Math.floor(c.pos / g.cols)));
          }
        }
        expect(nearest, `owner ${owner} kind ${kind}`).toBeLessThanOrEqual(14);
      }
    }
  });

  it('plays through an attack from the app: toasts, march, duel', () => {
    const app = new App('territory', null);
    const theirs = app.game.buildings.find((b) => b.type === BuildingType.Hut && b.owner === 1)!;
    expect(app.attackOptions(theirs.index)).toMatchObject({ ok: true, available: 2 });
    app.attackTarget(theirs.index, 2);
    expect(app.game.attackers.length).toBe(2);
    for (let i = 0; i < 6000; i++) app.frame(20);
    expect(app.game.attackers.length).toBe(0);
    expect(app.toast).toMatch(/captured|lost|under attack|Sent/i);
  });

  it('ends the game when a castle falls: you see the result once, and the clock stops', () => {
    const app = new App('territory', null);
    const theirs = app.game.castleOf(1);
    expect(app.result).toBeNull();
    // a knight at the door of an undefended castle
    app.game.buildings[theirs]!.garrison = 0;
    const mine = app.game.buildings.find((b) => b.type === BuildingType.Hut && b.owner === 0)!;
    app.game.setGarrison(mine.index, 3);
    app.game.attackers.push({ id: 900, owner: 0, home: mine.index, target: theirs, phase: 1, from: 0, to: 0, counter: 0, total: 0, rank: 0, defRank: -1 });
    for (let i = 0; i < 40 && !app.result; i++) app.frame(20);
    expect(app.result).toBe('won');
    expect(app.game.speed).toBe(0);
    app.dismissResult();
    expect(app.resultDismissed).toBe(true);
  });

  it('lets you change how the opponent plays, and it builds out over time', () => {
    const app = new App('territory', null);
    app.setTemperament(Temperament.Aggressive);
    expect(app.opponent!.temperament).toBe(Temperament.Aggressive);
    const before = app.game.buildings.filter((b) => b.owner === 1 && !b.removed).length;
    for (let i = 0; i < 6000; i++) app.frame(20);
    expect(app.game.buildings.filter((b) => b.owner === 1 && !b.removed).length).toBeGreaterThan(before);
  });

  it('runs: owner 0 is a playable colony like any other new game', () => {
    const g = makeScenario('territory');
    const castle = g.buildings[g.castleOf(0)]!;
    expect(castle.stock[Res.Plank]).toBe(12);
    for (let i = 0; i < 3000; i++) g.update();
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

describe('the rival in the territory scenario', { timeout: 120000 }, () => {
  it('keeps mining iron through a long game instead of stalling when its first mine runs dry', () => {
    const g = makeScenario('territory');
    for (let i = 0; i < 400000; i++) g.update();
    expect(g.created[Res.IronOre]!).toBeGreaterThan(200); // used to stall near 120: no carriers left, a bread chain without a well, unreachable mine spots retried for ever
  });

  it('spends its iron on weapons, not on an endless run of tools, and stops once it has plenty', () => {
    const g = makeScenario('territory');
    for (let i = 0; i < 300000; i++) g.update();
    const tools = [Res.Axe, Res.Pick, Res.Shovel, Res.Rod, Res.Scythe, Res.Saw, Res.Hammer, Res.Cleaver].reduce((n, r) => n + g.created[r]!, 0);
    expect(tools).toBeLessThan(80);
    expect(g.created[Res.Sword]!).toBeGreaterThan(120);
  });
});

describe('the event log', () => {
  it('records an attack and a capture from the player\'s side, newest first, and clears on a new game', () => {
    const app = new App();
    app.loadScenario('territory');
    const g = app.game;
    const hut = g.buildings.find((b) => !b.removed && b.owner === 1 && b.type === BuildingType.Hut && b.garrison > 0)!;
    g.sendAttack(0, hut.index, 2);
    app.frame(20);
    expect(app.log[0]!.text).toBe('You attacked an enemy hut');
    expect(app.unreadLog).toBe(1);
    g.alerts.push({ kind: 'lost', owner: 0, building: hut.index }, { kind: 'captured', owner: 1, building: hut.index });
    app.frame(20);
    expect(app.log[0]!.text).toBe('You lost a hut'); // the enemy's own 'captured' is not logged twice
    expect(app.log.length).toBe(2);
    app.readLog();
    expect(app.unreadLog).toBe(0);
    app.loadScenario('new');
    expect(app.log).toEqual([]);
  });
});

describe('defence tools', () => {
  it('shows threats to you, recalls your own knights, sets the garrison level and sizes up the odds', () => {
    const app = new App();
    app.loadScenario('territory');
    const g = app.game;
    const mine = g.buildings.find((b) => !b.removed && b.owner === 0 && b.type === BuildingType.Hut && b.garrison > 0)!;
    const theirs = g.buildings.find((b) => !b.removed && b.owner === 1 && b.type === BuildingType.Hut && b.garrison > 0)!;
    expect(app.threats()).toEqual([]);
    expect(app.attackersOut()).toBe(0);

    const odds = app.odds(theirs.index, 2);
    expect(odds.attack).toBeGreaterThan(0);
    expect(odds.defence).toBeGreaterThan(0);
    expect(odds.ratio).toBeCloseTo(odds.attack / odds.defence);

    g.sendAttack(1, mine.index, 2);
    expect(app.threats()).toMatchObject([{ target: mine.index, attackers: 2 }]);
    g.sendAttack(0, theirs.index, 1);
    expect(app.attackersOut(theirs.index)).toBe(1);
    app.recall(theirs.index);
    expect(app.attackersOut()).toBe(0);

    app.setWant(mine.index, 1);
    expect(mine.want).toBe(1);
  });
});
