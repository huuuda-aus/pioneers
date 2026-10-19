// The little people: poses are plain numbers, so the animation can be checked
// without a canvas.
import { describe, expect, it } from 'vitest';
import { BuildingType } from '@sett/sim';
import { pose, tradeOf } from '../src/people.ts';

const TAU = Math.PI * 2;

describe('walking', () => {
  it('the feet swap sides half a cycle apart', () => {
    const a = pose('walk', 0.9, 1);
    const b = pose('walk', 0.9 + Math.PI, 1);
    expect(a.footFront.x).toBeCloseTo(b.footBack.x, 6);
    expect(a.footBack.x).toBeCloseTo(b.footFront.x, 6);
  });

  it('it is periodic, and the feet never go below the ground', () => {
    for (let ph = 0; ph < TAU; ph += 0.3) {
      const a = pose('walk', ph, 1);
      const b = pose('walk', ph + TAU, 1);
      expect(a.head.y).toBeCloseTo(b.head.y, 6);
      expect(a.footFront.y).toBeLessThanOrEqual(0);
      expect(a.footBack.y).toBeLessThanOrEqual(0);
    }
  });

  it('the body bobs: the head rises and falls with each step', () => {
    const ys = [0, 0.5, 1, 1.5, 2, 2.5, 3].map((p) => pose('walk', p, 1).head.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.5);
  });

  it('arms swing against the legs', () => {
    const a = pose('walk', 1.0, 1);
    // the front foot is forward of the hip while the free hand is behind the front hand
    const legSide = Math.sign(a.footFront.x - a.hip.x);
    const armSide = Math.sign(a.handFront.x - a.handBack.x);
    expect(legSide).not.toBe(0);
    expect(armSide).toBe(-legSide);
  });
});

describe('facing', () => {
  it('left is the mirror of right', () => {
    for (const action of ['walk', 'idle', 'work'] as const) {
      const r = pose(action, 1.3, 1, 'lumberjack');
      const l = pose(action, 1.3, -1, 'lumberjack');
      expect(l.head.x).toBeCloseTo(-r.head.x, 6);
      expect(l.footFront.x).toBeCloseTo(-r.footFront.x, 6);
      expect(l.handFront.x).toBeCloseTo(-r.handFront.x, 6);
      expect(l.head.y).toBeCloseTo(r.head.y, 6);
    }
  });
});

describe('working', () => {
  it('the tool is raised, then brought down', () => {
    const angles = [0, 0.4, 0.8, 1.2, 1.6, 2, 2.4, 2.8, 3.2, 3.6, 4, 4.4, 4.8, 5.2, 5.6, 6].map((p) => pose('work', p, 1, 'lumberjack').toolAngle);
    expect(Math.min(...angles)).toBeLessThan(-1.5); // raised behind
    expect(Math.max(...angles)).toBeGreaterThan(0); // at the strike
  });

  it('the hands go up and down with the swing', () => {
    const ys = [0, 0.8, 1.6, 2.4, 3.2, 4, 4.8, 5.6].map((p) => pose('work', p, 1, 'stonecutter').handFront.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(5);
  });

  it('a forester stoops to plant rather than swinging overhead', () => {
    const ys = [0, 1, 2, 3, 4, 5, 6].map((p) => pose('work', p, 1, 'forester').handFront.y);
    const axe = [0, 1, 2, 3, 4, 5, 6].map((p) => pose('work', p, 1, 'lumberjack').handFront.y);
    expect(Math.min(...ys)).toBeGreaterThan(Math.min(...axe));
  });

  it('idle is nearly still: it only breathes', () => {
    const ys = [0, 1, 2, 3, 4, 5, 6].map((p) => pose('idle', p, 1).head.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1.5);
  });
});

describe('trades', () => {
  it('every working building has a trade, stores have none', () => {
    expect(tradeOf(BuildingType.Lumberjack)).toBe('lumberjack');
    expect(tradeOf(BuildingType.Stonecutter)).toBe('stonecutter');
    expect(tradeOf(BuildingType.Baker)).toBe('baker');
    expect(tradeOf(BuildingType.StoneMine)).toBe('miner');
    expect(tradeOf(BuildingType.Storage)).toBeNull();
    expect(tradeOf(BuildingType.Castle)).toBeNull();
    const all = Object.values(BuildingType).filter((v): v is number => typeof v === 'number');
    for (const t of all) {
      if (t !== BuildingType.Storage && t !== BuildingType.Castle) expect(tradeOf(t), `type ${t}`).not.toBeNull();
    }
  });
});
