/**
 * risk-unit-adapter.test.ts
 * -----------------------------------------------------------------------------
 * Pins the adapter's data-authenticity and derived-field logic against the
 * real 06/24 sample-unit files - section 0.6's pciIsReal split, plus the
 * repaired-unit count, with RWY 06/24 sample-unit data aligned to the user's
 * cross-year Markov workbook (workbook row 1 maps to sample unit 1, so the
 * previously reversed 300-to-1 survey payloads have been moved without
 * changing unit identities or geometry).
 * -----------------------------------------------------------------------------
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isPciReal, polygonAreaM2, toUnitRiskInputs } from './risk-unit-adapter.ts';
import type { GeoJSONFeatureCollection } from './geojson-types.ts';

function loadFc(relativePath: string): GeoJSONFeatureCollection {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf-8'));
}

const runwaySurveyFiles = [
  { branchId: '06/24', fileStem: 'runway-06-24', years: [2023, 2024, 2025, 2026] },
  { branchId: '07L/25R', fileStem: 'runway-07L-25R', years: [2020, 2021, 2022, 2023, 2024, 2025, 2026] },
] as const;

const allowedNegativePciCorrelations = new Set([
  '06/24:2025-2026',
]);

function featuresBySampleUnit(fc: GeoJSONFeatureCollection) {
  return new Map(fc.features.map((feature) => [feature.properties.sampleUnit, feature]));
}

function pearsonCorrelation(left: number[], right: number[]): number {
  assert.equal(left.length, right.length, 'correlation inputs must have the same length');
  assert.ok(left.length > 1, 'correlation requires at least two sample units');

  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }

  return covariance / Math.sqrt(leftVariance * rightVariance);
}

test('pciIsReal is true only for 06/24 and 07L/25R', () => {
  assert.equal(isPciReal('06/24'), true);
  assert.equal(isPciReal('07L/25R'), true);
  assert.equal(isPciReal('NP2'), false);
  assert.equal(isPciReal('Apron A'), false);
});

test('RWY 06/24 endpoint survey payloads follow the Markov workbook sample-unit direction', () => {
  const expected = [
    { year: 2023, unit1Pci: 100, unit300Pci: 100 },
    { year: 2024, unit1Pci: 100, unit300Pci: 100 },
    { year: 2025, unit1Pci: 100, unit300Pci: 99.0000007152557 },
    { year: 2026, unit1Pci: 99, unit300Pci: 100 },
  ];

  for (const { year, unit1Pci, unit300Pci } of expected) {
    const fc = loadFc(`../../public/data/runway-06-24-units-${year}.json`);
    const unit1 = fc.features.find((feature) => feature.properties.sampleUnit === 1);
    const unit300 = fc.features.find((feature) => feature.properties.sampleUnit === 300);
    assert.equal(unit1?.properties.pci_score, unit1Pci, `${year} unit 1 PCI`);
    assert.equal(unit300?.properties.pci_score, unit300Pci, `${year} unit 300 PCI`);
  }

  const fc2026 = loadFc('../../public/data/runway-06-24-units-2026.json');
  const unit1 = fc2026.features.find((feature) => feature.properties.sampleUnit === 1);
  const unit300 = fc2026.features.find((feature) => feature.properties.sampleUnit === 300);
  assert.deepEqual(unit1?.properties.distresses, [
    { type: 'Raveling', severity: 'Low', quantity: 0.06, quantityUnits: 'SqM', deduct: 1 },
  ]);
  assert.deepEqual(unit300?.properties.distresses, []);
});

test('runway geometry for each sample unit is identical across every survey year on its branch', () => {
  for (const { branchId, fileStem, years } of runwaySurveyFiles) {
    const baselineYear = years[0];
    const baseline = featuresBySampleUnit(loadFc(`../../public/data/${fileStem}-units-${baselineYear}.json`));

    for (const year of years.slice(1)) {
      const current = featuresBySampleUnit(loadFc(`../../public/data/${fileStem}-units-${year}.json`));
      assert.deepEqual(
        [...current.keys()].sort((a, b) => a - b),
        [...baseline.keys()].sort((a, b) => a - b),
        `${branchId} ${baselineYear}-${year}: sample-unit identities differ`,
      );

      for (const [sampleUnit, baselineFeature] of baseline) {
        assert.deepEqual(
          current.get(sampleUnit)?.geometry,
          baselineFeature.geometry,
          `${branchId} ${baselineYear}-${year}: geometry differs for sample unit ${sampleUnit}`,
        );
      }
    }
  }
});

test('sample unit 1 sits at the eastern threshold (24 / 25R) on both runways', () => {
  const meanLon = (feature: GeoJSONFeatureCollection['features'][number]) => {
    const ring = (feature.geometry.coordinates as unknown as number[][][])[0];
    return ring.reduce((sum, [lon]) => sum + lon, 0) / ring.length;
  };
  for (const { branchId, fileStem, years } of runwaySurveyFiles) {
    const units = featuresBySampleUnit(loadFc(`../../public/data/${fileStem}-units-${years[0]}.json`));
    const last = Math.max(...units.keys());
    assert.ok(meanLon(units.get(1)!) > meanLon(units.get(last)!), `${branchId}: unit 1 is not east of unit ${last}`);
  }
});

test('consecutive runway survey years have positive PCI correlation except documented current anomalies', () => {
  for (const { branchId, fileStem, years } of runwaySurveyFiles) {
    for (let index = 1; index < years.length; index += 1) {
      const previousYear = years[index - 1];
      const currentYear = years[index];
      const pairName = `${branchId}:${previousYear}-${currentYear}`;
      const previous = featuresBySampleUnit(loadFc(`../../public/data/${fileStem}-units-${previousYear}.json`));
      const current = featuresBySampleUnit(loadFc(`../../public/data/${fileStem}-units-${currentYear}.json`));
      const sampleUnits = [...previous.keys()].filter((sampleUnit) => current.has(sampleUnit)).sort((a, b) => a - b);
      const correlation = pearsonCorrelation(
        sampleUnits.map((sampleUnit) => Number(previous.get(sampleUnit)?.properties.pci_score)),
        sampleUnits.map((sampleUnit) => Number(current.get(sampleUnit)?.properties.pci_score)),
      );

      assert.ok(Number.isFinite(correlation), `${branchId} ${previousYear}-${currentYear}: PCI correlation is not finite`);
      if (allowedNegativePciCorrelations.has(pairName)) {
        assert.ok(
          correlation < 0,
          `${branchId} ${previousYear}-${currentYear}: allowlisted PCI anomaly is no longer negative (${correlation.toFixed(6)}); remove it from the allowlist`,
        );
      } else {
        assert.ok(
          correlation > 0,
          `${branchId} ${previousYear}-${currentYear}: expected positive PCI correlation, got ${correlation.toFixed(6)}`,
        );
      }
    }
  }
});

test('polygonAreaM2 on a real 06/24 unit polygon lands in the surveyed 560-604 m2 range', () => {
  // Unit 1 (the runway-24 end, after fixing the sample-unit numbering vs.
  // PAVER's convention) is a real edge square smaller than the ~604 m2
  // interior nominal - 567.84 m2, not a bug. Range widened to cover it.
  const fc = loadFc('../../public/data/runway-06-24-units-2025.json');
  const ring = fc.features[0].geometry.coordinates as unknown as number[][][];
  const area = polygonAreaM2(ring[0]);
  assert.ok(area > 560 && area < 605, `expected ~560-604 m2, got ${area}`);
});

test('repairedSincePrevious is always false (section 7.4: the patched-area-growth rule is switched off)', () => {
  const fc2026 = loadFc('../../public/data/runway-06-24-units-2026.json');
  const fc2025 = loadFc('../../public/data/runway-06-24-units-2025.json');
  const inputs = toUnitRiskInputs('06/24', 'runway', 2026, fc2026, fc2025, 2025);
  const repaired = inputs.filter((i) => i.repairedSincePrevious).length;
  assert.equal(repaired, 0);
});

test('every unit from the real-PCI branch is flagged pciIsReal, and carries a defined previousPci and previousSurveyYear', () => {
  const fc2026 = loadFc('../../public/data/runway-06-24-units-2026.json');
  const fc2025 = loadFc('../../public/data/runway-06-24-units-2025.json');
  const inputs = toUnitRiskInputs('06/24', 'runway', 2026, fc2026, fc2025, 2025);
  assert.equal(inputs.length, 300);
  for (const i of inputs) {
    assert.equal(i.pciIsReal, true);
    assert.equal(i.previousPciIsReal, true);
    assert.equal(typeof i.previousPci, 'number');
    assert.equal(i.previousSurveyYear, 2025);
  }
});

test('astmConsistent flags exactly one unit across the whole network: 06/24 2025 unit 86', () => {
  const fc2025 = loadFc('../../public/data/runway-06-24-units-2025.json');
  const fc2024 = loadFc('../../public/data/runway-06-24-units-2024.json');
  const fc2026 = loadFc('../../public/data/runway-06-24-units-2026.json');
  const fcRwy2_2026 = loadFc('../../public/data/runway-07L-25R-units-2026.json');

  const inputs2025 = toUnitRiskInputs('06/24', 'runway', 2025, fc2025, fc2024, 2024);
  const inputs2026 = toUnitRiskInputs('06/24', 'runway', 2026, fc2026, fc2025, 2025);
  const inputsRwy2 = toUnitRiskInputs('07L/25R', 'runway', 2026, fcRwy2_2026);

  const flagged = [...inputs2025, ...inputs2026, ...inputsRwy2].filter((i) => !i.astmConsistent);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].branchId, '06/24');
  assert.equal(flagged[0].unitNumber, 86);
});

test('an unrecognised quantityUnits value throws rather than silently converting', () => {
  const fc: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          square_id: 1,
          sampleUnit: 1,
          sampleUnitSet: 'test',
          pci_score: 90,
          pci_rating: 'Good',
          distresses: [{ type: 'Raveling', severity: 'Low', quantity: 1, quantityUnits: 'FT', deduct: 1 }],
        },
        geometry: { type: 'Polygon', coordinates: [] },
      },
    ],
  };
  assert.throws(() => toUnitRiskInputs('06/24', 'runway', 2026, fc));
});

test('a feature with no usable polygon geometry falls back to the 600 m2 nominal area', () => {
  const fc: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { square_id: 1, sampleUnit: 1, sampleUnitSet: 'test', pci_score: 90, pci_rating: 'Good' },
        geometry: { type: 'Polygon', coordinates: [] },
      },
    ],
  };
  const [input] = toUnitRiskInputs('06/24', 'runway', 2026, fc);
  assert.equal(input.areaM2, 600);
  assert.equal(input.areaIsNominal, true);
});
