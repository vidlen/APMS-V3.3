// src/lib/skid.ts — bantuan untuk data per unit (dipakai peta, heatmap unit, ringkasan, panel unit).
import { classifySkid } from "../config/skid.ts";
import type { SkidClass } from "../config/skid.ts";
import type { LaneCode, SkidBasis, SkidLaneValue, SkidRunwayData, SkidUnit } from "../types/skid.ts";

export const governingFor = (u: SkidUnit, basis: SkidBasis) => (basis === "152m" ? u.governing_152m : u.governing_10m);

export const laneMu = (l: SkidLaneValue, basis: SkidBasis) => (basis === "152m" ? l.mu_152m : l.mu_10m);

export interface SkidSummary {
  counts: Record<SkidClass, number>;          // jumlah unit per kelas nilai penentu
  measured: number;                           // unit yang punya data
  lowest: { unit: number; lane: LaneCode; mu: number } | null;
}

/** Ringkasan runway untuk basis aktif. Unit tanpa data hanya masuk ke counts.noData. */
export function summarize(d: SkidRunwayData, basis: SkidBasis): SkidSummary {
  const counts: Record<SkidClass, number> = { belowMinimum: 0, belowMaintenance: 0, aboveMaintenance: 0, newDesign: 0, noData: 0 };
  let lowest: SkidSummary["lowest"] = null;
  for (const u of d.units) {
    const g = governingFor(u, basis);
    counts[classifySkid(g?.mu ?? null)]++;
    if (g && (lowest === null || g.mu < lowest.mu)) lowest = { unit: u.unit, lane: g.lane, mu: g.mu };
  }
  return { counts, measured: d.units.length - counts.noData, lowest };
}

/** Rentang stasiun [awal, akhir) satu unit dari berkas per unit (2 desimal; cukup untuk menggambar). */
export function unitStationRange(units: readonly SkidUnit[], unit: number): [number, number] {
  const u = units[unit - 1];
  const next = units[unit];
  return [u.station_start_m, next ? next.station_start_m : 2 * u.station_mid_m - u.station_start_m];
}
