// The landscape's colours and noise: deterministic, in range, and shaped the
// way the picture needs (deeper water darker, snow high and not on cliffs, tree
// species in stands).
import { describe, expect, it } from 'vitest';
import {
  clamp,
  fbm2,
  grassColor,
  hash2,
  leafColors,
  lerpColor,
  luma,
  noise2,
  rockColor,
  SEA_STOPS,
  seaColor,
  sandColor,
  scaleColor,
  slopeLight,
  speciesAt,
  waterColor,
  type Species,
} from '../src/art.ts';

const valid = (c: number) => Number.isInteger(c) && c >= 0 && c <= 0xffffff;

describe('noise', () => {
  it('is the same every time and lies in [0, 1)', () => {
    for (let i = 0; i < 400; i++) {
      const x = i * 0.37 - 20;
      const y = i * 0.91 - 50;
      expect(noise2(x, y, 3)).toBe(noise2(x, y, 3));
      expect(hash2(i, -i, 4)).toBe(hash2(i, -i, 4));
      for (const v of [noise2(x, y, 3), hash2(i, i * 7, 4), fbm2(x, y, 3)]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('is smooth: a small step changes it a little', () => {
    let worst = 0;
    for (let i = 0; i < 500; i++) {
      const x = i * 0.13;
      worst = Math.max(worst, Math.abs(noise2(x, 2.5, 1) - noise2(x + 0.02, 2.5, 1)));
    }
    expect(worst).toBeLessThan(0.1);
  });

  it('the seed changes it, and the hash looks uniform', () => {
    expect(noise2(3.3, 4.4, 1)).not.toBe(noise2(3.3, 4.4, 2));
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += hash2(i, i * 3, 9);
    expect(sum / 4000).toBeGreaterThan(0.45);
    expect(sum / 4000).toBeLessThan(0.55);
  });
});

describe('colour helpers', () => {
  it('scale and lerp stay valid colours and hit their ends', () => {
    expect(scaleColor(0xffffff, 2)).toBe(0xffffff);
    expect(scaleColor(0x808080, 0)).toBe(0);
    expect(lerpColor(0x102030, 0xf0e0d0, 0)).toBe(0x102030);
    expect(lerpColor(0x102030, 0xf0e0d0, 1)).toBe(0xf0e0d0);
    expect(lerpColor(0x000000, 0xffffff, 2)).toBe(0xffffff); // clamped
    expect(clamp(5, 0, 3)).toBe(3);
  });

  it('light is 1 on level ground, brighter facing the light, darker facing away, never extreme', () => {
    expect(slopeLight(0, 0)).toBe(1);
    expect(slopeLight(-2, -2)).toBeLessThan(1);
    expect(slopeLight(2, 2)).toBeGreaterThan(1);
    expect(slopeLight(-99, -99)).toBeGreaterThanOrEqual(0.5);
    expect(slopeLight(99, 99)).toBeLessThanOrEqual(1.45);
  });
});

describe('ground colours', () => {
  it('grass is a valid colour and varies with height and with noise', () => {
    const low = grassColor(6, 0.2, 0.5);
    const high = grassColor(13, 0.2, 0.5);
    expect(valid(low) && valid(high)).toBe(true);
    expect(low).not.toBe(high);
    expect(grassColor(8, 0.9, 0.5)).not.toBe(grassColor(8, 0.1, 0.5));
    expect(luma(grassColor(8, 0.95, 0.5))).toBeLessThan(luma(grassColor(8, 0.1, 0.5))); // shady patches are darker
  });

  it('water gets darker with depth, and the shallows are lighter than the deep', () => {
    let last = Infinity;
    for (let d = 0; d <= 7; d++) {
      const l = luma(waterColor(d, 0.5));
      expect(l).toBeLessThanOrEqual(last + 0.001);
      last = l;
    }
    expect(luma(waterColor(0, 0.5))).toBeGreaterThan(luma(waterColor(7, 0.5)) + 30);
    expect(waterColor(99, 0.5)).toBe(waterColor(7, 0.5)); // capped
  });

  it('water is bluer than green or red, sand is warm', () => {
    for (const d of [0, 3, 7]) {
      const c = waterColor(d, 0.5);
      expect(c & 0xff).toBeGreaterThan((c >> 16) & 0xff);
      expect(c & 0xff).toBeGreaterThan((c >> 8) & 0xff);
    }
    const s = sandColor(0.5, 0.5);
    expect((s >> 16) & 0xff).toBeGreaterThan(s & 0xff);
  });

  it('rock turns to snow high up, and sheds it on steep faces', () => {
    const lowRock = rockColor(16, 1, 0.5, 0.5);
    const peak = rockColor(28, 1, 0.5, 0.5);
    const cliff = rockColor(28, 9, 0.5, 0.5);
    expect(luma(peak)).toBeGreaterThan(luma(lowRock) + 60);
    expect(luma(cliff)).toBeLessThan(luma(peak) - 40);
    for (const c of [lowRock, peak, cliff]) expect(valid(c)).toBe(true);
    // no snow below the snow line, however gentle
    expect(luma(rockColor(18, 0, 0.5, 0.5))).toBeLessThan(170);
  });
});

describe('the sea', () => {
  it('goes from turquoise at the beach to deep navy, getting darker all the way', () => {
    let last = Infinity;
    for (let d = 0; d <= 1200; d += 20) {
      const l = luma(seaColor(d, 0.5));
      expect(l).toBeLessThanOrEqual(last + 8); // swells ripple it a little
      last = l;
    }
    expect(luma(seaColor(0, 0.5))).toBeGreaterThan(luma(seaColor(1100, 0.5)) + 60);
  });

  it('is the plain deep colour from far out, so the picture meets the background', () => {
    const far = SEA_STOPS[SEA_STOPS.length - 1]![1];
    for (const d of [1100, 1300, 5000]) {
      const c = seaColor(d, 0.5);
      expect(Math.abs(luma(c) - luma(far))).toBeLessThan(4);
    }
    expect(seaColor(5000, 0.5)).toBe(seaColor(1100, 0.5));
  });

  it('is blue, valid, steady, and mottled by the noise', () => {
    for (let d = 0; d <= 1200; d += 100) {
      const c = seaColor(d, 0.4);
      expect(valid(c)).toBe(true);
      expect(c & 0xff).toBeGreaterThan((c >> 16) & 0xff);
      expect(seaColor(d, 0.4)).toBe(c);
    }
    expect(seaColor(300, 0.1)).not.toBe(seaColor(300, 0.9));
  });

  it('changes smoothly with distance: no step between neighbouring distances', () => {
    let worst = 0;
    for (let d = 0; d < 1100; d += 4) worst = Math.max(worst, Math.abs(luma(seaColor(d, 0.5)) - luma(seaColor(d + 4, 0.5))));
    expect(worst).toBeLessThan(2.5);
  });
});

describe('trees', () => {
  const species = (x: number, y: number, h = 9): Species => speciesAt(x, y, h, 0);

  it('the species of a point never changes', () => {
    for (let i = 0; i < 100; i++) expect(species(i, i * 3)).toBe(species(i, i * 3));
  });

  it('all three species grow somewhere', () => {
    const seen = new Set<Species>();
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) seen.add(species(x, y, 8 + ((x + y) % 7)));
    expect(seen.size).toBe(3);
  });

  it('they grow in stands: neighbours are alike more often than strangers', () => {
    let same = 0;
    let total = 0;
    let chance = 0;
    const count: Record<string, number> = { pine: 0, oak: 0, birch: 0 };
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 50; x++) {
        count[species(x, y)]!++;
        if (species(x, y) === species(x + 1, y)) same++;
        total++;
      }
    }
    for (const k of Object.keys(count)) chance += (count[k]! / 2500) ** 2;
    expect(same / total).toBeGreaterThan(chance + 0.12);
  });

  it('higher ground is more often pine', () => {
    let lowPine = 0;
    let highPine = 0;
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 50; x++) {
        if (species(x, y, 6) === 'pine') lowPine++;
        if (species(x, y, 14) === 'pine') highPine++;
      }
    }
    expect(highPine).toBeGreaterThan(lowPine);
  });

  it('each species has its own leaves, light side brighter than dark side', () => {
    const colours = (['pine', 'oak', 'birch'] as const).map((s) => leafColors(s, 0.5));
    for (const c of colours) {
      expect(valid(c.dark) && valid(c.light)).toBe(true);
      expect(luma(c.light)).toBeGreaterThan(luma(c.dark));
    }
    expect(new Set(colours.map((c) => c.light)).size).toBe(3);
    expect(leafColors('oak', 0)).not.toEqual(leafColors('oak', 1));
  });
});
