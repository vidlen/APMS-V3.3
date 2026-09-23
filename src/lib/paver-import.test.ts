/**
 * paver-import.test.ts
 * -----------------------------------------------------------------------------
 * Pins the PAVER Excel import: distresses follow their coordinate rather than a
 * shifted Sample Number column, the PCI sheet's total row is skipped, geometry
 * is left untouched, and a file that does not fit the runway is refused.
 * -----------------------------------------------------------------------------
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPaverSheets, paverToUnits } from './paver-import.ts';
import type { GeoJSONFeatureCollection } from './geojson-types.ts';

const square = (x: number) => [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]];
const base: GeoJSONFeatureCollection = {
  type: 'FeatureCollection',
  features: [1, 2, 3].map((n) => ({
    type: 'Feature',
    properties: { sampleUnit: n, pci_score: 0, pci_rating: 'Failed' },
    geometry: { type: 'Polygon', coordinates: square(n - 1) },
  })),
};

const pciRows = [
  ['Sample Number', 'PCI SAMPEL', 'SYS_UTM_X', 'SYS_UTM_Y'],
  [1, 100, 0.5, 0.5],
  [2, 87.5, 1.5, 0.5],
  [3, 60, 2.5, 0.5],
  ['NILAI PCI RUNWAY', 82.5, null, null],
];
const distressHead = ['Sample Number', 'Description', 'Severity', 'Quantity', 'Quantity Units', 'Deduct', 'SYS_UTM_X', 'SYS_UTM_Y'];

test('distresses land on the sample their coordinate names, not their shifted Sample Number', () => {
  const distressRows = [
    distressHead,
    [1, 'L & T CR', 'Medium', 4.56, 'M', 5.6, 1.5, 0.5], // listed 1, sits on sample 2
    [2, 'RAVELING', 'Low', 1.31, 'SqM', 1.2, 2.5, 0.5], // listed 2, sits on sample 3
    [3, 'PATCHING', 'High', 2, 'SqM', 9, null, null], // no coordinate: Sample Number is the fallback
  ];
  const result = paverToUnits(base, pciRows, distressRows);
  assert.ok(result.ok);
  const [u1, u2, u3] = result.data.features.map((f) => f.properties);
  assert.deepEqual(u1.distresses, []);
  assert.equal(u1.pci_rating, 'Good');
  assert.deepEqual((u2.distresses as { type: string }[]).map((x) => x.type), ['L & T CR']);
  assert.deepEqual((u3.distresses as { type: string }[]).map((x) => x.type), ['RAVELING', 'PATCHING']);
  assert.equal(u3.pci_score, 60);
  assert.deepEqual(result.data.features[0].geometry, base.features[0].geometry);
  assert.deepEqual(result.report, { samples: 3, distresses: 3, movedByCoordinate: 2, onMatchingPolygon: 3 });
});

test('a mirrored runway is imported but reported as off its polygons', () => {
  const mirrored = pciRows.map((r, i) => (i >= 1 && i <= 3 ? [r[0], r[1], 3 - (r[2] as number), r[3]] : r));
  const result = paverToUnits(base, mirrored, [distressHead]);
  assert.ok(result.ok);
  assert.equal(result.report.onMatchingPolygon, 1); // only the middle unit maps onto itself
});

test('refuses a file whose sample count does not fit the runway, or unknown quantity units', () => {
  const tooFew = paverToUnits(base, pciRows.slice(0, 3), [distressHead]);
  assert.equal(tooFew.ok, false);
  const badUnits = paverToUnits(base, pciRows, [distressHead, [1, 'RAVELING', 'Low', 1, 'Ft2', 1, 0.5, 0.5]]);
  assert.equal(badUnits.ok, false);
});

test('findPaverSheets picks sheets by header, whatever the tab is called', () => {
  const found = findPaverSheets([
    { sheet: 'Jenis Kerusakan Sort', data: [distressHead] },
    { sheet: 'PCI per Sampel Unit', data: pciRows },
  ]);
  assert.equal(found.pci, pciRows);
  assert.deepEqual(found.distress, [distressHead]);
});
