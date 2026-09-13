/**
 * consequence-apirm.ts
 * -----------------------------------------------------------------------------
 * Consequence dari tiga sumbu kondisi: struktur (S), gaya gesek (K), kerataan (G).
 *
 * Aturan tujuh baris di bawah diturunkan dengan mendekomposisi keduapuluh empat
 * skor risiko runway Seven & Yardim (2024) Tabel 7 hlm. 13 terhadap ruang
 * (L, F, C) Fine-Kinney. Setiap baris memberi satu nilai C, tanpa baris ambigu,
 * dan aturan ini mereproduksi keduapuluh empatnya. Atribut S, K, G tiap hazard
 * dibaca dari Tabel 4 hlm. 10-11.
 *
 * Yang DIKUTIP: aturannya sendiri, karena ia direproduksi utuh dari sumber.
 * Yang DITETAPKAN penelitian ini: pemetaan jenis distress ke ketiga sumbu.
 * -----------------------------------------------------------------------------
 */

import type { UnitDistress } from './risk-unit.ts';

export type StructuralState = 0 | 1 | 2 | 3; // none | minor | significant | major
export type FrictionState = 0 | 1;           // no evidence | measured loss
export type RoughnessState = 0 | 1 | 2;      // none | minor | partial

/** Distress yang dibaca sebagai kerusakan struktur. */
export const STRUCTURAL_DISTRESSES = ['ALLIGATOR CR', 'L & T CR', 'BLOCK CR'] as const;

/** Distress yang dibaca sebagai kehilangan kerataan. */
export const ROUGHNESS_DISTRESSES = ['RUTTING', 'CORRUGATION', 'DEPRESSION'] as const;

const STRUCTURAL_DISTRESS_SET = new Set<string>(STRUCTURAL_DISTRESSES);
const ROUGHNESS_DISTRESS_SET = new Set<string>(ROUGHNESS_DISTRESSES);

/** Keparahan tertinggi distress struktur pada unit: Low -> 1 (minor),
 *  Medium -> 2 (significant), High -> 3 (major); tidak ada -> 0 (none). */
export function structuralState(distresses: UnitDistress[]): StructuralState {
  let state: StructuralState = 0;
  for (const d of distresses) {
    if (!STRUCTURAL_DISTRESS_SET.has(d.type)) continue;
    const s: StructuralState = d.severity === 'High' ? 3 : d.severity === 'Medium' ? 2 : d.severity === 'Low' ? 1 : 0;
    if (s > state) state = s;
  }
  return state;
}

/** Keparahan tertinggi distress kerataan: Low -> 1, Medium atau High -> 2. */
export function roughnessState(distresses: UnitDistress[]): RoughnessState {
  let state: RoughnessState = 0;
  for (const d of distresses) {
    if (!ROUGHNESS_DISTRESS_SET.has(d.type)) continue;
    const s: RoughnessState = d.severity === 'Low' ? 1 : d.severity === 'Medium' || d.severity === 'High' ? 2 : 0;
    if (s > state) state = s;
  }
  return state;
}

/**
 * Bukti hilangnya gaya gesek. SELALU 0 sampai ada survei friction.
 * Jangan menurunkannya dari distress visual: Seven & Yardim membaca sumbu ini
 * dari kolom Friction hasil pengukuran, bukan dari pengamatan permukaan.
 * Akibat yang harus dinyatakan di antarmuka: C = 40 tidak terjangkau, dan kolom
 * keparahan ICAO A dan B kosong permanen.
 */
export function frictionState(): FrictionState {
  return 0;
}

/** Aturan tujuh baris. Diuji terhadap keduapuluh empat hazard runway. */
export function consequenceApirm(
  s: StructuralState,
  k: FrictionState,
  g: RoughnessState,
): number {
  if (s === 3 && k === 1) return 40;
  if (s === 3) return 15;
  if ((s === 1 || s === 2) && k === 1 && g === 2) return 15;
  if (k === 1) return 7;
  if (s === 2) return 7;
  if (g === 2) return 3;
  return 1;
}
