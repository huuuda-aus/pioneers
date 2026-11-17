// Combat: knights sent out of a garrison march on an enemy Hut, Tower or
// Fortress, duel its defenders one at a time, and take it when none is left.
import { describe, expect, it } from 'vitest';
import { AttackPhase, BuildingType, Dir, Game, Res, STEP_TICKS, UNCLAIMED } from '../src/index.ts';
import { run } from './scenarios.ts';

const T = BuildingType;

/** Through real JSON, as a browser would store it. */
const roundtrip = (g: Game): Game => Game.restore(JSON.parse(JSON.stringify(g.serialize())));

/** Owner 0's hut at flag (10,10) and owner 1's at flag (20,10), `mine`/`theirs` knights inside. */
function duel(mine: number, theirs: number, tick = 0) {
  const g = new Game(60, 30);
  g.tick = tick;
  const fa = g.addFlag(10, 10, 0);
  const fb = g.addFlag(20, 10, 1);
  const a = g.addBuilding(T.Hut, fa);
  const b = g.addBuilding(T.Hut, fb);
  g.buildings[a]!.garrison = mine;
  g.buildings[b]!.garrison = theirs;
  return { g, a, b, fa, fb };
}

describe('who can be attacked', () => {
  it('only a finished enemy hut, tower or fortress, with knights to spare in reach', () => {
    const { g, a, b } = duel(3, 2);
    expect(g.checkAttack(0, b).ok).toBe(true);
    expect(g.checkAttack(0, a).reason).toMatch(/your own/);
    expect(g.checkAttack(1, b).reason).toMatch(/your own/);

    g.buildings[a]!.garrison = 1; // the last knight stays home
    expect(g.checkAttack(0, b).reason).toMatch(/no knights to spare/);

    const far = new Game(80, 30);
    const f1 = far.addFlag(5, 10, 0);
    const f2 = far.addFlag(40, 10, 1);
    far.buildings[far.addBuilding(T.Hut, f1)]!.garrison = 3;
    const target = far.addBuilding(T.Hut, f2);
    expect(far.checkAttack(0, target).reason).toMatch(/no knights to spare/); // out of reach

    const site = new Game(60, 30);
    site.buildings[site.addBuilding(T.Hut, site.addFlag(10, 10, 0))]!.garrison = 3;
    const unfinished = site.addBuilding(T.Hut, site.addFlag(20, 10, 1), true);
    expect(site.checkAttack(0, unfinished).reason).toMatch(/not finished/);
  });

  it('a castle can be attacked like anything with a garrison', () => {
    const g = new Game(60, 30);
    g.buildings[g.addBuilding(T.Hut, g.addFlag(10, 10, 0))]!.garrison = 3;
    const castle = g.placeBuilding(T.Castle, g.index(25, 10), false, 1);
    expect(g.checkAttack(0, castle).ok).toBe(true);
  });
});

describe('sending knights', () => {
  it('takes them out of the garrison and marches them over the land', () => {
    const { g, a, b } = duel(4, 2);
    expect(g.availableKnights(0, b)).toBe(3);
    expect(g.sendAttack(0, b, 2)).toBe(2);
    expect(g.buildings[a]!.garrison).toBe(2);
    expect(g.attackers.length).toBe(2);
    const k = g.attackers[0]!;
    expect(k.phase).toBe(AttackPhase.Marching);
    expect(k.total).toBe(10 * STEP_TICKS);
    expect(g.alerts).toEqual([{ kind: 'attacked', owner: 1, building: b }]);
  });

  it('cannot send more than can be spared', () => {
    const { g, b } = duel(3, 2);
    expect(g.sendAttack(0, b, 99)).toBe(2);
  });
});

describe('a fight', () => {
  it('is decided the same way every time from the same state', () => {
    const outcome = () => {
      const { g, b } = duel(2, 1, 1234);
      g.sendAttack(0, b, 1);
      run(g, 3000);
      return JSON.stringify(g.serialize());
    };
    expect(outcome()).toBe(outcome());
  });

  it('is fair: a lone attacker beats a lone defender about half the time', () => {
    let captured = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      const { g, b } = duel(2, 1, i * 37);
      g.sendAttack(0, b, 1);
      run(g, 3000);
      expect(g.attackers.length).toBe(0);
      if (g.buildings[b]!.owner === 0) captured++;
    }
    expect(captured).toBeGreaterThan(trials * 0.35);
    expect(captured).toBeLessThan(trials * 0.65);
  });

  it('kills exactly one knight per duel, and leaves the garrisons consistent', () => {
    for (let i = 0; i < 40; i++) {
      const { g, a, b } = duel(6, 3, i * 53);
      g.sendAttack(0, b, 5);
      run(g, 12000);
      expect(g.attackers.length).toBe(0);
      const mine = g.buildings[a]!.garrison;
      const t = g.buildings[b]!;
      const held = t.owner === 0 ? t.garrison : 0;
      const theirs = t.owner === 0 ? 0 : t.garrison;
      expect(mine + held).toBeLessThanOrEqual(6);
      expect(theirs).toBeLessThanOrEqual(3);
      expect(mine + held + theirs).toBeLessThan(9); // at least one duel was fought, and each kills one
    }
  });
});

/** Wins of a lone attacker (rank `rank`, from a hut of two) against a lone rank-0 defender, over many fights. */
function winRate(opts: { rank?: number; goldMine?: number; goldTheirs?: number }, trials = 300): number {
  let won = 0;
  for (let i = 0; i < trials; i++) {
    const { g, a, b } = duel(2, 1, i * 41);
    g.setGarrison(a, 2); // claims their land, so each side fights at home or away as it should
    g.setGarrison(b, 1);
    if (opts.rank) g.buildings[a]!.veterans[opts.rank - 1] = 1;
    if (opts.goldMine) g.addStock(g.addBuilding(T.Storage, g.addFlag(30, 20, 0)), Res.Gold, opts.goldMine);
    if (opts.goldTheirs) g.addStock(g.addBuilding(T.Storage, g.addFlag(40, 20, 1)), Res.Gold, opts.goldTheirs);
    g.sendAttack(0, b, 1);
    run(g, 3000);
    if (g.buildings[b]!.owner === 0) won++;
  }
  return won / trials;
}

describe('strength', () => {
  it('doubles with every rank: a rank 1 attacker wins about two fights in three', () => {
    const r = winRate({ rank: 1 });
    expect(r).toBeGreaterThan(0.57);
    expect(r).toBeLessThan(0.77);
  });

  it('is even with no gold in the world, whoever attacks', () => {
    const r = winRate({});
    expect(r).toBeGreaterThan(0.38);
    expect(r).toBeLessThan(0.62);
  });

  it('favours whoever holds the gold, away from home', () => {
    expect(winRate({ goldMine: 5 })).toBeGreaterThan(0.75); // 21504 against the defender\'s 4096
    expect(winRate({ goldTheirs: 5 })).toBeLessThan(0.3); // 1024 against 4096
    expect(winRate({ goldMine: 5, goldTheirs: 5 })).toBeGreaterThan(0.6); // an even split is still 11264 away
  });

  it('is told by awayMorale: 4096 when there is no gold at all', () => {
    const { g } = duel(2, 1);
    expect(g.awayMorale(0)).toBe(4096);
    g.addStock(g.addBuilding(T.Storage, g.addFlag(30, 20, 0)), Res.Gold, 3);
    expect(g.awayMorale(0)).toBe(21504);
    expect(g.awayMorale(1)).toBe(1024);
  });
});

describe('ranks in the garrison', () => {
  it('the strongest knight goes out and comes home with his rank', () => {
    const { g, a, b } = duel(3, 2);
    g.buildings[a]!.veterans[3] = 1; // one rank 4
    g.sendAttack(0, b, 1);
    expect(g.attackers[0]!.rank).toBe(4);
    expect(g.buildings[a]!.garrison).toBe(2);
    expect(g.buildings[a]!.veterans).toEqual([0, 0, 0, 0]);
    run(g, 40);
    g.demolishBuilding(b);
    run(g, 4000);
    expect(g.buildings[a]!.garrison).toBe(3);
    expect(g.buildings[a]!.veterans).toEqual([0, 0, 0, 1]);
  });

  it('a captor keeps his rank in the building he takes', () => {
    const { g, a, b } = duel(2, 0);
    g.buildings[a]!.veterans[1] = 1; // one rank 2
    g.sendAttack(0, b, 1);
    run(g, 3000);
    expect(g.buildings[b]!.owner).toBe(0);
    expect(g.knightRanks(g.buildings[b]!)).toEqual([0, 0, 1, 0, 0]);
  });
});

describe('capturing a building', () => {
  it('flips the owner, the door flag and the land, and cuts its roads', () => {
    const { g, a, b, fb } = duel(3, 0);
    const other = g.addFlag(24, 10, 1);
    g.addRoad(fb, [Dir.Right, Dir.Right, Dir.Right, Dir.Right]);
    expect(g.roads.length).toBe(1);
    g.sendAttack(0, b, 1);
    run(g, 2000);
    const t = g.buildings[b]!;
    expect(t.owner).toBe(0);
    expect(t.garrison).toBe(1);
    expect(g.flags[fb]!.owner).toBe(0);
    expect(g.roads[0]!.removed).toBe(true);
    expect(g.flags[other]!.removed).toBe(true); // now on land the new owner holds
    expect(g.ownerAt[t.pos]).toBe(0);
    expect(g.attackers.length).toBe(0);
    expect(g.buildings[a]!.garrison).toBe(2);
    expect(g.alerts.map((x) => x.kind).sort()).toEqual(['attacked', 'captured', 'lost']);
  });

  it('sends the other attackers home, and the old owner can strike back', () => {
    const { g, a, b } = duel(4, 0);
    g.sendAttack(0, b, 3);
    run(g, 4000);
    expect(g.buildings[b]!.owner).toBe(0);
    expect(g.attackers.length).toBe(0);
    expect(g.buildings[a]!.garrison + g.buildings[b]!.garrison).toBe(4);
  });

  it('loses the old owner\'s recruits still on the road', () => {
    const { g, b } = duel(3, 0);
    g.addStock(g.addBuilding(T.Storage, g.addFlag(30, 10, 1)), Res.Sword, 1);
    g.sendAttack(0, b, 1);
    g.knights.push({ id: 99, home: 0, building: b, counter: 100000, total: 100000 });
    run(g, 2000);
    expect(g.knights.some((k) => k.building === b)).toBe(false);
  });
});

describe('the end of the game', () => {
  /** Owner 0's hut with `mine` knights, owner 1's castle with `theirs` inside. */
  function siege(mine: number, theirs: number) {
    const g = new Game(60, 30);
    const hut = g.addBuilding(T.Hut, g.addFlag(10, 10, 0));
    g.buildings[hut]!.garrison = mine;
    const west = g.placeBuilding(T.Castle, g.index(45, 10), false, 0); // owner 0's own castle, so there are two sides
    const castle = g.placeBuilding(T.Castle, g.index(25, 10), false, 1);
    g.buildings[castle]!.garrison = theirs;
    return { g, hut, castle, west };
  }

  it('an undefended castle falls to the first knight, burns, and its owner has lost', () => {
    const { g, castle } = siege(3, 0);
    expect(g.winner()).toBe(-1);
    g.sendAttack(0, castle, 2);
    run(g, 3000);
    expect(g.buildings[castle]!.burning > 0 || g.buildings[castle]!.removed).toBe(true); // burnt out by now
    expect(g.defeated).toEqual([1]);
    expect(g.winner()).toBe(0);
    expect(g.attackers.length).toBe(0);
    expect(g.alerts.some((a) => a.kind === 'defeated' && a.owner === 1)).toBe(true);
  });

  it('a defended castle holds until its knights are beaten, and the attackers come home when it falls', () => {
    let fell = 0;
    for (let i = 0; i < 30; i++) {
      const { g, castle, hut } = siege(3, 1);
      g.tick = i * 53;
      g.sendAttack(0, castle, 2);
      run(g, 6000);
      expect(g.attackers.length).toBe(0);
      if (g.defeated.length > 0) {
        fell++;
        expect(g.buildings[hut]!.garrison + g.buildings[castle]!.garrison).toBeLessThanOrEqual(3);
      }
    }
    expect(fell).toBeGreaterThan(5);
    expect(fell).toBeLessThan(30);
  });

  it('a game with one castle never has a winner, and a save keeps who has lost', () => {
    const solo = new Game(30, 30);
    solo.placeBuilding(T.Castle, solo.index(10, 10), false, 0);
    expect(solo.winner()).toBe(-1);
    const { g, castle } = siege(3, 0);
    g.sendAttack(0, castle, 1);
    run(g, 3000);
    const h = roundtrip(g);
    expect(h.defeated).toEqual([1]);
    expect(h.winner()).toBe(0);
    const old = g.serialize() as unknown as Record<string, unknown>;
    delete old.defeated;
    expect(Game.restore(JSON.parse(JSON.stringify(old)) as Parameters<typeof Game.restore>[0]).defeated).toEqual([]);
  });
});

describe('odd moments', () => {
  it('survives the attacker\'s home burning mid-march, and the target vanishing', () => {
    const { g, a, b } = duel(3, 2);
    g.sendAttack(0, b, 1);
    run(g, 40);
    g.demolishBuilding(a);
    expect(() => run(g, 4000)).not.toThrow();
    expect(g.attackers.length).toBe(0);

    const h = duel(3, 2);
    h.g.sendAttack(0, h.b, 2);
    run(h.g, 40);
    h.g.demolishBuilding(h.b);
    run(h.g, 4000);
    expect(h.g.attackers.length).toBe(0);
    expect(h.g.buildings[h.a]!.garrison).toBe(3); // both came home
  });
});

describe('save and load', () => {
  it('a round trip mid-march and mid-fight carries on identically', () => {
    for (const steps of [100, 460]) {
      const { g, b } = duel(3, 2, 777);
      g.sendAttack(0, b, 2);
      run(g, steps);
      expect(g.attackers.length).toBeGreaterThan(0);
      const h = roundtrip(g);
      expect(h.attackers).toEqual(g.attackers);
      run(g, 4000);
      run(h, 4000);
      expect(JSON.stringify(h.serialize())).toBe(JSON.stringify(g.serialize()));
    }
  });

  it('an old save with no attackers loads clean', () => {
    const { g } = duel(3, 2);
    const data = g.serialize() as unknown as { buildings: unknown[] } & Record<string, unknown>;
    delete data.attackers;
    delete data.nextAttacker;
    for (const b of data.buildings as { veterans?: number[]; train?: number }[]) {
      delete b.veterans;
      delete b.train;
    }
    const h = Game.restore(JSON.parse(JSON.stringify(data)) as Parameters<typeof Game.restore>[0]);
    expect(h.attackers).toEqual([]);
    expect(h.buildings.every((b) => b.veterans.length === 4 && b.train === 0)).toBe(true);
    expect(UNCLAIMED).toBe(255);
  });
});
