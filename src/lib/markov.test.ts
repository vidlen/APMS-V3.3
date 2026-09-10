import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildNRaw,
  buildTpmDirichlet,
  buildTpmThreshold,
  classify,
  classDistribution,
  computeMarkov,
  fillProbability,
  measuredRate,
  midpointOffset,
  monotonise,
} from "./markov.ts";

const MARKOV_PARAMS = {
  classLowerBounds: [86, 71, 56, 41, 26, 11, 0],
  classMidpoints: [93, 78, 63, 48, 33, 18, 5],
  classWidth: 15,
  thresholdN: 1,
  dirichletAlpha: 2,
  horizonYears: 5,
};

type SourceFile = { features: { properties: { sampleUnit: number; pci_score: number } }[] };

function loadPci(path: string) {
  const source = JSON.parse(readFileSync(path, "utf8")) as SourceFile;
  return source.features
    .slice()
    .sort((a, b) => a.properties.sampleUnit - b.properties.sampleUnit)
    .map((feature) => feature.properties.pci_score);
}

function closeTo(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

const previous = loadPci("public/data/runway-06-24-units-2025.json");
const next = loadPci("public/data/runway-06-24-units-2026.json");
const result = computeMarkov(previous, next, MARKOV_PARAMS);

test("classify honors lower class boundaries", () => {
  assert.equal(classify(86, MARKOV_PARAMS.classLowerBounds), 0);
  assert.equal(classify(85, MARKOV_PARAMS.classLowerBounds), 1);
  assert.equal(classify(56, MARKOV_PARAMS.classLowerBounds), 2);
  assert.equal(classify(55, MARKOV_PARAMS.classLowerBounds), 3);
});

test("live JSON has the workbook class distributions and raw transition rows", () => {
  assert.deepEqual(classDistribution(previous, MARKOV_PARAMS.classLowerBounds), [234, 58, 8, 0, 0, 0, 0]);
  assert.deepEqual(classDistribution(next, MARKOV_PARAMS.classLowerBounds), [199, 77, 23, 1, 0, 0, 0]);
  const raw = buildNRaw(previous, next, MARKOV_PARAMS.classLowerBounds);
  assert.deepEqual(raw[0], [144, 67, 22, 1, 0, 0, 0]);
  assert.deepEqual(raw[1], [48, 9, 1, 0, 0, 0, 0]);
  assert.deepEqual(monotonise(raw)[1], [0, 57, 1, 0, 0, 0, 0]);
  assert.deepEqual(monotonise(raw)[2], [0, 0, 8, 0, 0, 0, 0]);
});

test("parameter functions produce the live browser inputs", () => {
  closeTo(measuredRate(previous, next), 1.6956666666666817, 1e-12);
  closeTo(fillProbability(measuredRate(previous, next), 15), 0.8869555555555546, 1e-12);
  closeTo(midpointOffset(next, result.classDistribution.next, MARKOV_PARAMS.classMidpoints), 3.342, 1e-9);
});

test("both transition matrices remain upper triangular and normalized", () => {
  const matrices = [
    buildTpmThreshold(result.nMonotone, MARKOV_PARAMS.thresholdN, result.pFill),
    buildTpmDirichlet(result.nMonotone, MARKOV_PARAMS.dirichletAlpha),
  ];
  for (const matrix of matrices) {
    matrix.forEach((row, rowIndex) => {
      closeTo(row.reduce((sum, value) => sum + value, 0), 1, 1e-9);
      row.slice(0, rowIndex).forEach((value) => closeTo(value, 0, 1e-12));
    });
  }
  assert.equal(result.variants.n8.tpm[2][2], 1);
  closeTo(result.variants.dirichlet.tpm[2][2], 0.9);
});

test("projections agree with the workbook snapshot within one hundredth PCI point", () => {
  const snapshot = JSON.parse(readFileSync("public/data/markov-06-24-snapshot.json", "utf8")) as {
    variants: Record<string, { projection: { year: number; pci: number }[] }>;
  };
  for (const variant of ["n8", "dirichlet"] as const) {
    const expected = snapshot.variants[variant].projection;
    const actual = result.variants[variant].projection;
    expected.forEach((reference, index) => {
      assert.equal(actual[index].year, reference.year);
      closeTo(actual[index].pci, reference.pci, 0.01);
    });
  }
  closeTo(result.variants.n8.projection.at(-1)?.pci ?? 0, 77.84, 0.01);
  closeTo(result.variants.dirichlet.projection.at(-1)?.pci ?? 0, 74.93, 0.01);
});
