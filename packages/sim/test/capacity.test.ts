// Store capacity: with limits on, a finished castle or storage takes only so
// much of each resource. What does not fit stays on the flags, and the
// producers behind it back up. Off by default (the parity scenarios).
import { describe, expect, it } from 'vitest';
import { BState, BuildingType, Dir, Game, RES_COUNT, Res, type StoreLimits } from '../src/index.ts';
import * as sc from './scenarios.ts';

const R = Dir.Right;

function checkConservation(g: Game): void {
  for (let r = 0; r < RES_COUNT; r++) {
    expect(g.created[r]! - g.consumed[r]! - g.lost[r]!, `res ${r} at tick ${g.tick}`).toBe(g.countItems(r as Res));
  }
}

/** Items with a store as destination are exactly what the store counts as incoming. */
function checkIncoming(g: Game): void {
  for (const b of g.buildings) {
    if (b.removed || b.capacity <= 0) continue;
    for (let r = 0; r < RES_COUNT; r++) {
      let n = 0;
      for (const f of g.flags) for (const it of f.slot) if (it.type === r && it.dest === b.flag) n++;
      for (const t of g.transporters) if (!t.gone && t.item.type === r && t.item.dest === b.flag) n++;
      expect(b.incoming[r], `store ${b.index} res ${r} at tick ${g.tick}`).toBe(n);
      expect(b.stock[r]! + b.incoming[r]!, `store ${b.index} over capacity`).toBeLessThanOrEqual(b.capacity);
    }
  }
}

/** flags x=1,3,..,9 on row 1; lumberjack at the first, castle at the last. */
function line(limits: StoreLimits | null, extraStorageAt = -1) {
  const g = new Game(16, 4);
  g.limits = limits;
  const f = sc.row(g, 1, 9, 1, 2);
  const castle = g.addBuilding(BuildingType.Castle, f[f.length - 1]!);
  const jack = g.addBuilding(BuildingType.Lumberjack, f[2]!);
  const storage = extraStorageAt >= 0 ? g.addBuilding(BuildingType.Storage, f[extraStorageAt]!) : -1;
  return { g, castle, jack, storage };
}

describe('store capacity', () => {
  it('is unlimited unless the game turns limits on', () => {
    const { g, castle } = line(null);
    expect(g.buildings[castle]!.capacity).toBe(0);
    sc.run(g, 12000);
    expect(g.buildings[castle]!.stock[Res.Lumber]).toBeGreaterThan(20);
  });

  it('gives the castle and a finished storage their own limits', () => {
    const { g, castle, storage } = line({ castle: 7, storage: 4 }, 0);
    expect(g.buildings[castle]!.capacity).toBe(7);
    expect(g.buildings[storage]!.capacity).toBe(4);
  });

  it('a storage takes its limit when its construction finishes, not before', () => {
    const g = new Game(30, 16);
    g.limits = { castle: 50, storage: 9 };
    const castle = g.placeBuilding(BuildingType.Castle, g.index(4, 4), false);
    g.addStock(castle, Res.Plank, 10);
    g.addStock(castle, Res.Stone, 10);
    const st = g.placeBuilding(BuildingType.Storage, g.index(14, 4), true);
    g.addRoad(g.flagAtPos(g.index(5, 5)), new Array<Dir>(10).fill(R));
    expect(g.buildings[st]!.capacity).toBe(0);
    sc.run(g, 3000);
    expect(g.buildings[st]!.constructing).toBe(false);
    expect(g.buildings[st]!.capacity).toBe(9);
  });

  it('never holds more than its limit, and the producer backs up behind it', () => {
    const { g, castle, jack } = line({ castle: 5, storage: 5 });
    let blocked = false;
    sc.run(g, 15000, (gg, i) => {
      expect(gg.buildings[castle]!.stock[Res.Lumber]).toBeLessThanOrEqual(5);
      if (i % 25 === 0) {
        checkConservation(gg);
        checkIncoming(gg);
      }
      if (gg.buildings[jack]!.state === BState.OutputBlocked) blocked = true;
    });
    expect(g.buildings[castle]!.stock[Res.Lumber]).toBe(5);
    expect(blocked).toBe(true); // flags filled up
    expect(g.countItems(Res.Lumber)).toBeGreaterThan(5);
  });

  it('overflow goes to another storage that still has room', () => {
    const { g, castle, storage } = line({ castle: 4, storage: 3 }, 0);
    sc.run(g, 20000, (gg, i) => {
      if (i % 25 === 0) {
        checkConservation(gg);
        checkIncoming(gg);
      }
    });
    expect(g.buildings[castle]!.stock[Res.Lumber]).toBe(4);
    expect(g.buildings[storage]!.stock[Res.Lumber]).toBe(3);
  });

  it('takes goods again once stock leaves it', () => {
    const { g, castle } = line({ castle: 3, storage: 3 });
    sc.run(g, 12000);
    const c = g.buildings[castle]!;
    expect(c.stock[Res.Lumber]).toBe(3);
    const before = g.created[Res.Lumber]!;
    c.stock[Res.Lumber] = 0; // as if dispatched
    g.consumed[Res.Lumber] += 3;
    sc.run(g, 4000);
    expect(c.stock[Res.Lumber]).toBe(3);
    expect(g.created[Res.Lumber]).toBeGreaterThanOrEqual(before);
  });

  it('keeps its accounting straight when a road under delivery is removed', () => {
    const { g, castle } = line({ castle: 6, storage: 6 });
    // cut at a moment when lumber is on the way and waiting at the flag before the gap
    for (let i = 0; i < 20000; i++) {
      g.update();
      const cf = g.buildings[castle]!.flag;
      if (g.flags[3]!.slot.some((it) => it.type === Res.Lumber && it.dest === cf)) break;
    }
    expect(g.buildings[castle]!.incoming[Res.Lumber]).toBeGreaterThan(0);
    g.demolishRoad(3);
    sc.run(g, 1);
    checkIncoming(g); // cancelled requests were given back
    sc.run(g, 2000, (gg, i) => {
      if (i % 25 === 0) {
        checkConservation(gg);
        checkIncoming(gg);
      }
    });
    g.addRoad(3, [R, R]);
    sc.run(g, 6000, (gg, i) => {
      if (i % 25 === 0) {
        checkConservation(gg);
        checkIncoming(gg);
      }
    });
  });
});
