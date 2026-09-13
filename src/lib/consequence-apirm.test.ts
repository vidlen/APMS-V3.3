/**
 * consequence-apirm.test.ts
 * -----------------------------------------------------------------------------
 * Locks consequenceApirm's seven-line rule against all 24 Seven & Yardim
 * (2024) Table 7 runway hazards it reproduces (brief-implementasi-b-r2
 * section 3.2), plus the frictionState/consequenceApirm safety invariants.
 * -----------------------------------------------------------------------------
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consequenceApirm, frictionState, type StructuralState, type FrictionState, type RoughnessState } from './consequence-apirm.ts';

const HAZARDS: Array<{ hz: number; s: StructuralState; k: FrictionState; g: RoughnessState; c: number }> = [
  { hz: 1, s: 0, k: 0, g: 0, c: 1 },
  { hz: 2, s: 0, k: 0, g: 1, c: 1 },
  { hz: 3, s: 0, k: 0, g: 2, c: 3 },
  { hz: 4, s: 0, k: 1, g: 0, c: 7 },
  { hz: 5, s: 0, k: 1, g: 1, c: 7 },
  { hz: 6, s: 0, k: 1, g: 2, c: 7 },
  { hz: 7, s: 1, k: 0, g: 0, c: 1 },
  { hz: 8, s: 1, k: 0, g: 1, c: 1 },
  { hz: 9, s: 1, k: 0, g: 2, c: 3 },
  { hz: 10, s: 1, k: 1, g: 0, c: 7 },
  { hz: 11, s: 1, k: 1, g: 1, c: 7 },
  { hz: 12, s: 1, k: 1, g: 2, c: 15 },
  { hz: 13, s: 2, k: 0, g: 0, c: 7 },
  { hz: 14, s: 2, k: 0, g: 1, c: 7 },
  { hz: 15, s: 2, k: 0, g: 2, c: 7 },
  { hz: 16, s: 2, k: 1, g: 0, c: 7 },
  { hz: 17, s: 2, k: 1, g: 1, c: 7 },
  { hz: 18, s: 2, k: 1, g: 2, c: 15 },
  { hz: 19, s: 3, k: 0, g: 0, c: 15 },
  { hz: 20, s: 3, k: 0, g: 1, c: 15 },
  { hz: 21, s: 3, k: 0, g: 2, c: 15 },
  { hz: 22, s: 3, k: 1, g: 0, c: 40 },
  { hz: 23, s: 3, k: 1, g: 1, c: 40 },
  { hz: 24, s: 3, k: 1, g: 2, c: 40 },
];

test('consequenceApirm: reproduces all 24 Seven & Yardim runway hazards', () => {
  assert.equal(HAZARDS.length, 24);
  for (const h of HAZARDS) {
    assert.equal(consequenceApirm(h.s, h.k, h.g), h.c, `hazard ${h.hz} (S=${h.s} K=${h.k} G=${h.g})`);
  }
});

test('frictionState always returns 0, and consequenceApirm never returns 40 while k is 0', () => {
  assert.equal(frictionState(), 0);
  for (const s of [0, 1, 2, 3] as const) {
    for (const g of [0, 1, 2] as const) {
      assert.notEqual(consequenceApirm(s, 0, g), 40);
    }
  }
});
