/** Locks the B-R3 FODp calculation: Shah equation [9] with Table 8 weights. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOD_CRACK_EXTENT,
  FOD_INDEX_DENOMINATOR,
  FOD_RAVELING_EXTENT,
  FOD_SEVERITY_WEIGHT,
  consequenceFod,
  fodBreakdown,
  fodIndex,
  fodState,
} from './fod-index.ts';
import { LINEAR_INFLUENCE_WIDTH_M } from '../config/riskScales.ts';
import type { UnitDistress } from './risk-unit.ts';

function raveling(quantity: number, severity: UnitDistress['severity']): UnitDistress {
  return { type: 'RAVELING', severity, quantity, quantityUnits: 'SqM', deduct: 0 };
}

function cracking(quantity: number, severity: UnitDistress['severity']): UnitDistress {
  return { type: 'L & T CR', severity, quantity, quantityUnits: 'M', deduct: 0 };
}

test('FODp exposes the Shah/Table 8 constants used by B-R3', () => {
  assert.deepEqual(FOD_RAVELING_EXTENT, [
    { minPct: 20, weight: 5 }, { minPct: 1, weight: 3 }, { minPct: 0, weight: 1 },
  ]);
  assert.deepEqual(FOD_CRACK_EXTENT, [
    { minPct: 30, weight: 5 }, { minPct: 10, weight: 3 }, { minPct: 0, weight: 1 },
  ]);
  assert.deepEqual(FOD_SEVERITY_WEIGHT, { Low: 1, Medium: 3, High: 5 });
  assert.equal(FOD_INDEX_DENOMINATOR, 20);
});

test('raveling extent boundaries use 600 m2 coverage and do not round', () => {
  assert.equal(fodBreakdown([raveling(5.94, 'Low')]).ravelingWeight, 2); // 0.99%
  assert.equal(fodBreakdown([raveling(6, 'Low')]).ravelingWeight, 4); // 1.00%
  assert.equal(fodBreakdown([raveling(119.94, 'Low')]).ravelingWeight, 4); // 19.99%
  assert.equal(fodBreakdown([raveling(120, 'Low')]).ravelingWeight, 6); // 20.00%
});

test('L&T cracking extent converts metres to area before applying its boundaries', () => {
  const metresFor = (percent: number) => percent / 100 * 600 / LINEAR_INFLUENCE_WIDTH_M;
  assert.equal(fodBreakdown([cracking(metresFor(9.99), 'Low')]).crackWeight, 2);
  assert.equal(fodBreakdown([cracking(metresFor(10), 'Low')]).crackWeight, 4);
  assert.equal(fodBreakdown([cracking(metresFor(29.99), 'Low')]).crackWeight, 4);
  assert.equal(fodBreakdown([cracking(metresFor(30), 'Low')]).crackWeight, 6);
  // The FODp variable is linear by definition. A legacy SqM label on an L&T
  // record does not turn its quantity into an area measurement.
  assert.equal(fodBreakdown([{ ...cracking(4.73, 'Medium'), quantityUnits: 'SqM' }]).crackWeight, 4);
});

test('each component combines its extent weight and its highest observed severity weight', () => {
  assert.equal(fodBreakdown([raveling(3, 'Low')]).ravelingWeight, 2);
  assert.equal(fodBreakdown([raveling(3, 'Medium')]).ravelingWeight, 4);
  assert.equal(fodBreakdown([raveling(3, 'High')]).ravelingWeight, 6);
  assert.equal(fodBreakdown([cracking(1, 'Low')]).crackWeight, 2);
  assert.equal(fodBreakdown([cracking(1, 'Medium')]).crackWeight, 4);
  assert.equal(fodBreakdown([cracking(1, 'High')]).crackWeight, 6);
});

test('FODp state boundaries and consequences follow the B-R3 table', () => {
  assert.deepEqual(
    [0, 1, 1.01, 12.5, 12.51, 30, 30.01, 50, 50.01, 65, 65.01, 80, 80.01].map(fodState),
    [1, 1, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6, 7],
  );
  assert.equal(consequenceFod([]), 1);
  assert.equal(consequenceFod([raveling(120.01, 'High')]), 15);
});

test('an absent FOD variable contributes zero rather than a Low severity weight', () => {
  assert.deepEqual(fodBreakdown([]), { index: 0, state: 1, ravelingWeight: 0, crackWeight: 0 });
  assert.equal(fodIndex([]), 0);
  assert.equal(consequenceFod([]), 1);
});

test('the two component weights are added before Shah equation [9] is evaluated', () => {
  const maxCrackMetres = 30.01 / 100 * 600 / LINEAR_INFLUENCE_WIDTH_M;
  const result = fodBreakdown([raveling(120.01, 'High'), cracking(maxCrackMetres, 'High')]);
  assert.deepEqual({ ravelingWeight: result.ravelingWeight, crackWeight: result.crackWeight }, {
    ravelingWeight: 10, crackWeight: 10,
  });
  assert.equal(result.index, 100);
  assert.equal(result.state, 7);
});
