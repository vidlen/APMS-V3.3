// src/lib/texture.ts — helper murni tab Macrotexture. Tanpa React dan tanpa `ol`, supaya bisa diuji dengan node --test.
import {
  TEXTURE_CLASSES,
  TEXTURE_LANE_MIN_N,
  TEXTURE_LEVELS_MM,
  classifyTexture,
  etdFromMpd,
  faaLevel,
  type TextureClass,
  type TextureFaaLevel,
} from "../config/texture.ts";
import type { TextureRunwayData, TextureUnit, TextureZone, TextureZoneId } from "../types/texture.ts";

export type TextureMode = "etd" | "mpd";
export type TextureZoneChoice = "all" | TextureZoneId;

const FAA_ORDER: TextureFaaLevel[] = ["ok", "measure", "plan", "gap", "correct"];

export interface TextureSummaryFigures {
  lowest: TextureUnit | null;
  highest: TextureUnit | null;
  medianEtd: number | null;
  nWithKeel: number;
  /** Unit ber-ETD keel < 0,76, nomor naik. */
  belowPlanning: number[];
  zonesBelowMeasure: number;
  /** Tingkat FAA terburuk di antara zona. */
  worstLevel: TextureFaaLevel;
  classCounts: Record<TextureClass, number>;
}

export function summarizeTexture(data: TextureRunwayData): TextureSummaryFigures {
  const withKeel = data.units.filter((u) => u.keel.etd_mm !== null);
  const etd = (u: TextureUnit) => u.keel.etd_mm as number;
  const sorted = withKeel.map(etd).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  // Urutan units naik dan pembandingnya tegas, jadi seri jatuh ke nomor unit terkecil.
  const pick = (better: (a: number, b: number) => boolean) =>
    withKeel.reduce<TextureUnit | null>((best, u) => (!best || better(etd(u), etd(best)) ? u : best), null);
  const classCounts = Object.fromEntries(TEXTURE_CLASSES.map((c) => [c, 0])) as Record<TextureClass, number>;
  for (const u of data.units) classCounts[classifyTexture(u.keel.etd_mm)]++;
  const levels = data.zones.map((z) => FAA_ORDER.indexOf(faaLevel(z.etd_mm)));
  return {
    lowest: pick((a, b) => a < b),
    highest: pick((a, b) => a > b),
    medianEtd: sorted.length === 0 ? null : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    nWithKeel: withKeel.length,
    belowPlanning: withKeel.filter((u) => etd(u) < TEXTURE_LEVELS_MM.plan).map((u) => u.unit),
    zonesBelowMeasure: data.zones.filter((z) => z.etd_mm < TEXTURE_LEVELS_MM.measure).length,
    worstLevel: FAA_ORDER[Math.max(0, ...levels)],
    classCounts,
  };
}

/** Unit berisi nilai keel > 2 mm: diarsir di peta. */
export const hasHighKeel = (u: TextureUnit): boolean => u.high_values.some((v) => v.keel);

export interface TextureAlongRow {
  x: number;
  unit: number;
  keel: number | null;
  full: number | null;
}

/** Satu baris grafik sepanjang runway per unit. Unit tanpa nilai keel punya `keel: null`, jadi garisnya putus di situ. */
export function alongRows(data: TextureRunwayData, mode: TextureMode): TextureAlongRow[] {
  return data.units.map((u) => ({
    x: u.x_mid_m,
    unit: u.unit,
    keel: mode === "etd" ? u.keel.etd_mm : u.keel.mpd_mm,
    full: mode === "etd" ? u.full.etd_mm : u.full.mpd_mm,
  }));
}

/** Rentang x sebuah zona: dari tengah celah dengan zona sebelumnya sampai tengah celah dengan zona berikutnya. */
export function zoneXRange(data: TextureRunwayData, zone: TextureZone): [number, number] {
  const [first, last] = zone.units;
  const edge = (a: number) => (data.units[a - 1].x_mid_m + data.units[a].x_mid_m) / 2;
  return [first <= 1 ? 0 : edge(first - 1), last >= data.units.length ? data.axis.length_m : edge(last)];
}

export interface TextureLaneRow {
  x: number; // tengah lajur
  from: number;
  to: number;
  n: number;
  mpd: number | null;
  etd: number | null;
  thin: boolean;
}

/** Baris profil melintang, 120 lajur 0,5 m. Lajur n = 0 punya `mpd: null`, jadi tidak tergambar. */
export function laneRows(data: TextureRunwayData, zone: TextureZoneChoice): TextureLaneRow[] {
  const { width_m, offset_min_m, count } = data.lanes;
  const set = zone === "all" ? data.lanes.all : data.lanes[`zone${zone}`];
  return Array.from({ length: count }, (_, i) => {
    const mpd = set.mpd_mm[i];
    const from = offset_min_m + i * width_m;
    return { x: from + width_m / 2, from, to: from + width_m, n: set.n[i], mpd, etd: mpd === null ? null : etdFromMpd(mpd), thin: set.n[i] < TEXTURE_LANE_MIN_N };
  });
}

/** Nomor berurutan jadi rentang: [1, 2, 3, 298, 299, 300] -> ["1–3", "298–300"]. */
export function unitRanges(units: readonly number[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < units.length; i++) {
    let j = i;
    while (j + 1 < units.length && units[j + 1] === units[j] + 1) j++;
    out.push(i === j ? `${units[i]}` : `${units[i]}–${units[j]}`);
    i = j;
  }
  return out;
}
