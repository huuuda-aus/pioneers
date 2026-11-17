// Zoomed out, the map is drawn with cheap stand-ins: the tier switches with a little hysteresis, and each stand-in
// emits a small fraction of the shapes of the full picture.
import { describe, expect, it } from 'vitest';
import { BuildingType } from '@sett/sim';
import { drawBuildingArt } from '../src/buildings.ts';
import { LOD_FAR, LOD_HYSTERESIS, drawBuildingFar, drawFarRock, drawFarTrees, lodOf } from '../src/lod.ts';
import { BUILDING_COLOR } from '../src/palette.ts';

/** A Graphics look-alike that counts every call. */
function counter(): { g: never; calls: () => number } {
  let n = 0;
  const g: unknown = new Proxy({}, { get: () => () => (n++, g) });
  return { g: g as never, calls: () => n };
}

describe('the detail tier', () => {
  it('is far below the threshold and near above it', () => {
    expect(lodOf(LOD_FAR - 0.01)).toBe('far');
    expect(lodOf(LOD_FAR)).toBe('near');
    expect(lodOf(1.5)).toBe('near');
    expect(lodOf(0.2)).toBe('far');
  });
  it('does not flicker: once far it stays far until a little above the threshold', () => {
    expect(lodOf(LOD_FAR + LOD_HYSTERESIS / 2, 'far')).toBe('far');
    expect(lodOf(LOD_FAR + LOD_HYSTERESIS, 'far')).toBe('near');
    expect(lodOf(LOD_FAR - 0.001, 'near')).toBe('far');
  });
});

describe('the cheap pictures', () => {
  it('a stand of trees and a rock are a couple of shapes each', () => {
    const t = counter();
    drawFarTrees(t.g, 10, 10, 'oak', 0.3);
    expect(t.calls()).toBeLessThanOrEqual(4);
    const r = counter();
    drawFarRock(r.g, 10, 10, 4);
    expect(r.calls()).toBeLessThanOrEqual(2);
  });

  it('every building is a block of a few shapes, a fraction of its full art', () => {
    const all = Object.values(BuildingType).filter((v): v is number => typeof v === 'number');
    for (const type of all) {
      const far = counter();
      drawBuildingFar(far.g, 100, 100, 34, 24, BUILDING_COLOR[type] ?? 0x999999);
      expect(far.calls()).toBeLessThanOrEqual(8);
      const full = counter();
      drawBuildingArt(full.g, { type, cx: 100, cy: 100, w: 34, h: 24, time: 1, working: false, progress: 1, seed: 1, ore: 1 });
      expect(far.calls() * 5, BuildingType[type]).toBeLessThanOrEqual(full.calls());
    }
  });

  it('a site is the same block, see-through', () => {
    const rec: unknown[][] = [];
    const g: unknown = new Proxy({}, { get: (_t, name) => (...a: unknown[]) => (rec.push([name, ...a]), g) });
    drawBuildingFar(g as never, 0, 0, 34, 24, 0x888888, 0.4);
    expect(JSON.stringify(rec)).toContain('"alpha":0.55');
  });
});
