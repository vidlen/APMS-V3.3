export type ClassIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type Matrix7 = number[][];
export type MarkovVariant = "n8" | "dirichlet";

export interface MarkovParams {
  classLowerBounds: number[];
  classMidpoints: number[];
  classWidth: number;
  thresholdN: number;
  dirichletAlpha: number;
  horizonYears: number;
}

export interface MarkovProjection {
  year: number;
  classShare: number[];
  pci: number;
}

export interface MarkovVariantResult {
  tpm: Matrix7;
  projection: MarkovProjection[];
}

export interface MarkovResult {
  classDistribution: { previous: number[]; next: number[] };
  nRaw: Matrix7;
  nMonotone: Matrix7;
  measuredRate: number;
  pFill: number;
  offset: number;
  variants: Record<MarkovVariant, MarkovVariantResult>;
}

const CLASS_COUNT = 7;
const ANCHOR_YEAR = 2026;

function emptyMatrix(): Matrix7 {
  return Array.from({ length: CLASS_COUNT }, () => Array<number>(CLASS_COUNT).fill(0));
}

function assertPair(previous: number[], next: number[]) {
  if (previous.length === 0 || previous.length !== next.length) {
    throw new Error("PCI lists must have the same non-zero unit count.");
  }
}

function rowTotal(row: number[]) {
  return row.reduce((total, value) => total + value, 0);
}

function multiplyRowVector(vector: number[], matrix: Matrix7) {
  return matrix[0].map((_, column) =>
    vector.reduce((total, value, row) => total + value * matrix[row][column], 0),
  );
}

export function classify(pci: number, bounds: number[]): ClassIndex {
  if (!Number.isFinite(pci) || bounds.length !== CLASS_COUNT) {
    throw new Error("PCI and class boundaries must be numeric across seven classes.");
  }
  const index = bounds.findIndex((bound) => pci >= bound);
  return (index === -1 ? CLASS_COUNT - 1 : index) as ClassIndex;
}

export function classDistribution(pciList: number[], bounds: number[]): number[] {
  const distribution = Array<number>(CLASS_COUNT).fill(0);
  for (const pci of pciList) distribution[classify(pci, bounds)] += 1;
  return distribution;
}

export function buildNRaw(previous: number[], next: number[], bounds: number[]): Matrix7 {
  assertPair(previous, next);
  const matrix = emptyMatrix();
  previous.forEach((pci, index) => {
    matrix[classify(pci, bounds)][classify(next[index], bounds)] += 1;
  });
  return matrix;
}

/** Moves every apparent improvement into its source class before probabilities are estimated. */
export function monotonise(nRaw: Matrix7): Matrix7 {
  const matrix = emptyMatrix();
  for (let row = 0; row < CLASS_COUNT; row += 1) {
    const source = nRaw[row] ?? [];
    matrix[row][row] = source.slice(0, row + 1).reduce((total, value) => total + (value ?? 0), 0);
    for (let column = row + 1; column < CLASS_COUNT; column += 1) {
      matrix[row][column] = source[column] ?? 0;
    }
  }
  return matrix;
}

export function measuredRate(previous: number[], next: number[]): number {
  assertPair(previous, next);
  return (rowTotal(previous) - rowTotal(next)) / previous.length;
}

export function fillProbability(rate: number, classWidth: number): number {
  if (!Number.isFinite(rate) || !Number.isFinite(classWidth) || classWidth <= 0) {
    throw new Error("Rate and class width must be finite, with a positive class width.");
  }
  return 1 - rate / classWidth;
}

export function midpointOffset(nextPciList: number[], distribution: number[], midpoints: number[]): number {
  if (distribution.length !== CLASS_COUNT || midpoints.length !== CLASS_COUNT || nextPciList.length === 0) {
    throw new Error("Distribution and midpoints must contain seven classes.");
  }
  const total = rowTotal(distribution);
  if (total === 0) throw new Error("Class distribution cannot be empty.");
  const averagePci = rowTotal(nextPciList) / nextPciList.length;
  const midpointAverage = distribution.reduce((sum, count, index) => sum + count * midpoints[index], 0) / total;
  return averagePci - midpointAverage;
}

function assertTpm(tpm: Matrix7) {
  for (let row = 0; row < CLASS_COUNT; row += 1) {
    for (let column = 0; column < row; column += 1) {
      if (Math.abs(tpm[row][column]) > 1e-9) throw new Error("TPM cannot contain probabilities below its diagonal.");
    }
    if (Math.abs(rowTotal(tpm[row]) - 1) > 1e-9) throw new Error("Every TPM row must sum to one.");
  }
}

export function buildTpmThreshold(nMono: Matrix7, thresholdN: number, pFill: number): Matrix7 {
  const tpm = emptyMatrix();
  for (let row = 0; row < CLASS_COUNT; row += 1) {
    if (row === CLASS_COUNT - 1) {
      tpm[row][row] = 1;
      continue;
    }
    const count = rowTotal(nMono[row] ?? []);
    if (count >= thresholdN) {
      for (let column = row; column < CLASS_COUNT; column += 1) tpm[row][column] = (nMono[row][column] ?? 0) / count;
    } else {
      tpm[row][row] = pFill;
      tpm[row][row + 1] = 1 - pFill;
    }
  }
  assertTpm(tpm);
  return tpm;
}

export function buildTpmDirichlet(nMono: Matrix7, alpha: number): Matrix7 {
  if (!Number.isFinite(alpha) || alpha < 0) throw new Error("Alpha must be zero or positive.");
  const tpm = emptyMatrix();
  for (let row = 0; row < CLASS_COUNT; row += 1) {
    if (row === CLASS_COUNT - 1) {
      tpm[row][row] = 1;
      continue;
    }
    const count = rowTotal(nMono[row] ?? []);
    if (count === 0 && alpha === 0) {
      throw new Error("Alpha zero cannot be used on a row without observations.");
    }
    const denominator = count + alpha;
    for (let column = row; column < CLASS_COUNT; column += 1) {
      const priorWeight = column === row || column === row + 1 ? alpha / 2 : 0;
      tpm[row][column] = ((nMono[row][column] ?? 0) + priorWeight) / denominator;
    }
  }
  assertTpm(tpm);
  return tpm;
}

export function project(
  a0: number[],
  tpm: Matrix7,
  midpoints: number[],
  offset: number,
  years: number,
): MarkovProjection[] {
  const total = rowTotal(a0);
  if (a0.length !== CLASS_COUNT || midpoints.length !== CLASS_COUNT || total === 0 || years < 0) {
    throw new Error("Projection input is incomplete.");
  }
  assertTpm(tpm);
  let share = a0.map((value) => value / total);
  return Array.from({ length: years + 1 }, (_, step) => {
    const result = {
      year: ANCHOR_YEAR + step,
      classShare: share,
      pci: share.reduce((sum, value, index) => sum + value * midpoints[index], 0) + offset,
    };
    share = multiplyRowVector(share, tpm);
    return result;
  });
}

export function computeMarkov(previous: number[], next: number[], params: MarkovParams): MarkovResult {
  assertPair(previous, next);
  const previousDistribution = classDistribution(previous, params.classLowerBounds);
  const nextDistribution = classDistribution(next, params.classLowerBounds);
  const nRaw = buildNRaw(previous, next, params.classLowerBounds);
  const nMonotone = monotonise(nRaw);
  const rate = measuredRate(previous, next);
  const pFill = fillProbability(rate, params.classWidth);
  const offset = midpointOffset(next, nextDistribution, params.classMidpoints);
  const n8Tpm = buildTpmThreshold(nMonotone, params.thresholdN, pFill);
  const dirichletTpm = buildTpmDirichlet(nMonotone, params.dirichletAlpha);

  return {
    classDistribution: { previous: previousDistribution, next: nextDistribution },
    nRaw,
    nMonotone,
    measuredRate: rate,
    pFill,
    offset,
    variants: {
      n8: { tpm: n8Tpm, projection: project(nextDistribution, n8Tpm, params.classMidpoints, offset, params.horizonYears) },
      dirichlet: {
        tpm: dirichletTpm,
        projection: project(nextDistribution, dirichletTpm, params.classMidpoints, offset, params.horizonYears),
      },
    },
  };
}
