/**
 * fod-index.test.ts
 * -----------------------------------------------------------------------------
 * Locks fodIndex's extent/severity weighting, fodState's Shah Tabel 12
 * boundaries, and the no-raveling anchor (brief-implementasi-b-r2 section 4.2).
 * -----------------------------------------------------------------------------
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fodIndex, fodState, consequenceFod } from './fod-index.ts';
import type { UnitDistress } from './risk-unit.ts';

function raveling(quantity: number, severity: UnitDistress['severity']): UnitDistress[] {
  return [{ type: 'RAVELING', severity, quantity, quantityUnits: 'SqM', deduct: 0 }];
}

test('fodIndex: extent boundaries at 0.99%/1.00% and 19.99%/20.00% coverage', () => {
  assert.equal(fodIndex(raveling(5.94, 'Low')), 20);  // 0.99% -> Low extent (weight 1) + Low severity (1)
  assert.equal(fodIndex(raveling(6, 'Low')), 40);      // 1.00% -> Medium extent (weight 3) + Low severity (1)
  assert.equal(fodIndex(raveling(119.94, 'Low')), 40); // 19.99% -> still Medium extent (weight 3)
  assert.equal(fodIndex(raveling(120, 'Low')), 60);    // 20.00% -> High extent (weight 5) + Low severity (1)
});

test('fodIndex: severity weights Low/Medium/High give 1/3/5', () => {
  assert.equal(fodIndex(raveling(3, 'Low')), 20);    // Low extent (1) + Low severity (1)
  assert.equal(fodIndex(raveling(3, 'Medium')), 40); // Low extent (1) + Medium severity (3)
  assert.equal(fodIndex(raveling(3, 'High')), 60);   // Low extent (1) + High severity (5)
});

test('fodState: boundaries at 1, 12.5, 30, 50, 65, 80 and 80.1 give state 1, 3, 4, 5, 6, 6, 7', () => {
  assert.equal(fodState(1), 1);
  assert.equal(fodState(12.5), 3);
  assert.equal(fodState(30), 4);
  assert.equal(fodState(50), 5);
  assert.equal(fodState(65), 6);
  assert.equal(fodState(80), 6);
  assert.equal(fodState(80.1), 7);
});

test('a unit with no raveling has index 0, state 1, and consequenceFod 1', () => {
  assert.equal(fodIndex([]), 0);
  assert.equal(fodState(0), 1);
  assert.equal(consequenceFod([]), 1);
});
