// The TypeScript sim must reproduce the C++ reference exactly: same result
// numbers and the same state fingerprint after 15000 steps. Regenerate the
// fixture with `pnpm gen:parity` after changing the C++ model.
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/parity.json';
import { allParityScenarios } from './scenarios.ts';

describe('parity with the C++ reference', () => {
  const actual = allParityScenarios();

  it('covers every scenario in the fixture', () => {
    expect(Object.keys(actual).sort()).toEqual(Object.keys(fixture).sort());
  });

  for (const key of Object.keys(fixture)) {
    it(key, () => {
      expect(actual[key]).toEqual((fixture as Record<string, unknown>)[key]);
    });
  }
});
