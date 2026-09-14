/**
 * Indeks kerusakan benda asing (FODp) dari raveling dan L&T cracking.
 * Bentuk indeks mengikuti Shah dkk. (2004) persamaan [9] dan bobot Tabel 8.
 * Tabel 9 MTO tidak dipakai karena pita kerapatannya mulai di 10%, sehingga
 * data sample unit ini akan menumpuk di pita pertama dan sumbu kerapatan mati.
 */

import { COVERAGE_DIVISOR_M2, LINEAR_INFLUENCE_WIDTH_M } from '../config/riskScales.ts';
import type { UnitDistress } from './risk-unit.ts';

/** Bobot sebaran raveling, Shah Tabel 8. Dibaca tertinggi lebih dulu. */
export const FOD_RAVELING_EXTENT = [
  { minPct: 20, weight: 5 },
  { minPct: 1, weight: 3 },
  { minPct: 0, weight: 1 },
] as const;

/** Bobot sebaran L&T crack, Shah Tabel 8. Dibaca tertinggi lebih dulu. */
export const FOD_CRACK_EXTENT = [
  { minPct: 30, weight: 5 },
  { minPct: 10, weight: 3 },
  { minPct: 0, weight: 1 },
] as const;

/** Bobot keparahan Shah Tabel 8 untuk kedua indikator. */
export const FOD_SEVERITY_WEIGHT = { Low: 1, Medium: 3, High: 5 } as const;

/** Penyebut Shah persamaan [9]: maksimum (5 + 5) + (5 + 5). */
export const FOD_INDEX_DENOMINATOR = 20;

export type FodState = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface FodBreakdown {
  index: number;
  state: FodState;
  ravelingWeight: number;
  crackWeight: number;
}

/** Nilai C per state adalah jembatan penelitian, bukan kutipan Shah. */
export const FOD_STATE_CONSEQUENCE: Record<FodState, number> = {
  1: 1, 2: 1, 3: 3, 4: 7, 5: 15, 6: 15, 7: 15,
};

type Severity = keyof typeof FOD_SEVERITY_WEIGHT;
type ExtentBand = readonly { minPct: number; weight: number }[];

function isScoredSeverity(severity: UnitDistress['severity']): severity is Severity {
  return severity !== 'N/A';
}

function extentWeight(extentPct: number, bands: ExtentBand): number {
  for (const band of bands) {
    if (extentPct >= band.minPct) return band.weight;
  }
  return 0;
}

function componentWeight(distresses: UnitDistress[], bands: ExtentBand, areaM2: number): number {
  const scored = distresses.filter((distress): distress is UnitDistress & { severity: Severity } => isScoredSeverity(distress.severity));
  if (scored.length === 0) return 0;

  const extentPct = (areaM2 / COVERAGE_DIVISOR_M2) * 100;
  const severityWeight = Math.max(...scored.map((distress) => FOD_SEVERITY_WEIGHT[distress.severity]));
  return extentWeight(extentPct, bands) + severityWeight;
}

/** State FODp menurut Shah Tabel 12. */
export function fodState(index: number): FodState {
  if (index > 80) return 7;
  if (index >= 65) return 6;
  if (index >= 50) return 5;
  if (index >= 30) return 4;
  if (index >= 12.5) return 3;
  if (index > 1) return 2;
  return 1;
}

/**
 * Menghitung komponen Shah [9] sekali saja. Distress yang tidak ada memberi
 * bobot 0, bukan bobot terendah; L&T metres dikonversi memakai lebar pengaruh
 * yang sama dengan coveragePct sebelum sebarannya diklasifikasikan.
 */
export function fodBreakdown(distresses: UnitDistress[]): FodBreakdown {
  const raveling = distresses.filter((distress) => distress.type === 'RAVELING' && distress.quantityUnits === 'SqM');
  // L&T cracking is a linear FODp variable. Treat it as metres by type rather
  // than trusting an occasional legacy quantity-unit label in the survey JSON.
  const cracks = distresses.filter((distress) => distress.type === 'L & T CR');
  const ravelingWeight = componentWeight(
    raveling,
    FOD_RAVELING_EXTENT,
    raveling.reduce((sum, distress) => sum + distress.quantity, 0),
  );
  const crackWeight = componentWeight(
    cracks,
    FOD_CRACK_EXTENT,
    cracks.reduce((sum, distress) => sum + distress.quantity * LINEAR_INFLUENCE_WIDTH_M, 0),
  );
  const index = (100 * (ravelingWeight + crackWeight)) / FOD_INDEX_DENOMINATOR;
  return { index, state: fodState(index), ravelingWeight, crackWeight };
}

/** Indeks FODp 0–100. Gunakan fodBreakdown ketika komponen juga dibutuhkan. */
export function fodIndex(distresses: UnitDistress[]): number {
  return fodBreakdown(distresses).index;
}

export function consequenceFod(distresses: UnitDistress[]): number {
  return FOD_STATE_CONSEQUENCE[fodBreakdown(distresses).state];
}
