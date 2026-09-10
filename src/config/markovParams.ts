import type { MarkovParams } from "../lib/markov";

export const MARKOV_PARAMS: MarkovParams = {
  classLowerBounds: [86, 71, 56, 41, 26, 11, 0],
  classMidpoints: [93, 78, 63, 48, 33, 18, 5],
  classWidth: 15,
  thresholdN: 1,
  dirichletAlpha: 2,
  horizonYears: 5,
};

export const MARKOV_CLASS_LABELS = [
  "Good",
  "Satisfactory",
  "Fair",
  "Poor",
  "Very Poor",
  "Serious",
  "Failed",
] as const;
