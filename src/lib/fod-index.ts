/**
 * fod-index.ts
 * -----------------------------------------------------------------------------
 * Indeks kerusakan benda asing (FODp) dari raveling.
 *
 * Bentuk persamaan: Shah dkk. (2004) persamaan [9] hlm. 614,
 *   indeks = 100 (w_sebaran + w_keparahan) / Maks(w_sebaran + w_keparahan)
 * Bobot tingkat: Shah Tabel 8 hlm. 615, yaitu tabel yang Shah susun sendiri
 * untuk FODp. Tabel 9 hlm. 616 (MTO 1989) SENGAJA TIDAK DIPAKAI: pita
 * kerapatannya dimulai di 10% dan disusun untuk satu seksi jalan, sedangkan
 * kerapatan raveling pada sample unit 600 m2 di data ini bermedian 0,11% dan
 * 0,26% dengan maksimum 19,71%. Dengan pita MTO seluruh unit menumpuk di pita
 * pertama dan sumbu kerapatan mati.
 *
 * State: Shah Tabel 12 hlm. 617. Ambang 30 adalah garis immediate need yang
 * Shah adopsi dari HDM-4, hlm. 614.
 *
 * Yang DIKUTIP: bobot, penyebut, dan batas state.
 * Yang DITETAPKAN penelitian ini: kolom consequence di FOD_STATES.
 * -----------------------------------------------------------------------------
 */

import { COVERAGE_DIVISOR_M2 } from '../config/riskScales.ts';
import type { UnitDistress } from './risk-unit.ts';

/** Bobot sebaran raveling, Shah Tabel 8. Dibaca tertinggi lebih dulu. */
export const FOD_EXTENT_BANDS = [
  { minPct: 20, weight: 5 }, // High
  { minPct: 1, weight: 3 },  // Medium
  { minPct: 0, weight: 1 },  // Low
] as const;

/** Bobot keparahan raveling, Shah Tabel 8. */
export const FOD_SEVERITY_WEIGHT = { Low: 1, Medium: 3, High: 5 } as const;

/** Penyebut persamaan [9]: bobot maksimum 5 + 5. */
export const FOD_INDEX_DENOMINATOR = 10;

export type FodState = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Nilai C per state. INI JEMBATAN PENELITIAN, BUKAN KUTIPAN.
 * Dikurung tiga jangkar:
 *   state 1 memberi C = 1, sama dengan hazard 1 Seven & Yardim (perkerasan baru);
 *   langkah naiknya di indeks 30, garis immediate need Shah hlm. 614;
 *   puncaknya 15, bukan 40, karena pada sumbernya C = 40 disediakan khusus untuk
 *   kerusakan struktur berat yang disertai hilangnya gaya gesek (hazard 22-24).
 */
export const FOD_STATE_CONSEQUENCE: Record<FodState, number> = {
  1: 1, 2: 1, 3: 3, 4: 7, 5: 15, 6: 15, 7: 15,
};

/** Indeks 0 sampai 100. Unit tanpa raveling mengembalikan 0. Sebaran memakai
 *  pembagi yang sama dengan coveragePct (COVERAGE_DIVISOR_M2), bukan areaM2
 *  poligon unit; keparahan memakai keparahan raveling tertinggi pada unit. */
export function fodIndex(distresses: UnitDistress[]): number {
  const raveling = distresses.filter(
    (d): d is UnitDistress & { severity: 'Low' | 'Medium' | 'High' } =>
      d.type === 'RAVELING' && d.quantityUnits === 'SqM' && d.severity !== 'N/A',
  );
  if (raveling.length === 0) return 0;

  const extentPct = (raveling.reduce((sum, d) => sum + d.quantity, 0) / COVERAGE_DIVISOR_M2) * 100;
  let extentWeight: number = FOD_EXTENT_BANDS[FOD_EXTENT_BANDS.length - 1].weight;
  for (const band of FOD_EXTENT_BANDS) {
    if (extentPct >= band.minPct) {
      extentWeight = band.weight;
      break;
    }
  }

  const severityWeight = Math.max(...raveling.map((d) => FOD_SEVERITY_WEIGHT[d.severity]));

  return (100 * (extentWeight + severityWeight)) / FOD_INDEX_DENOMINATOR;
}

/** State menurut Shah Tabel 12. */
export function fodState(index: number): FodState {
  if (index > 80) return 7;
  if (index >= 65) return 6;
  if (index >= 50) return 5;
  if (index >= 30) return 4;
  if (index >= 12.5) return 3;
  if (index > 1) return 2;
  return 1;
}

export function consequenceFod(distresses: UnitDistress[]): number {
  return FOD_STATE_CONSEQUENCE[fodState(fodIndex(distresses))];
}
