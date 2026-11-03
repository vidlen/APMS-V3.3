// src/lib/bbi.ts — helper murni tab Roughness (BBI). Tanpa React dan tanpa `ol`, supaya bisa diuji dengan node --test.
import { BBI_CLASSES, BBI_LIMIT, classifyBbi, type BbiClass } from "../config/bbi.ts";
import type { BbiLineTrace, BbiRunwayData, BbiUnit } from "../types/bbi.ts";

export { classifyBbi };

/** Di atas jendela ini profil digambar sebagai maks per bin 1 m; di bawahnya titik 0,25 m apa adanya. */
export const PROFILE_RAW_WINDOW_M = 600;

export interface BbiSummary {
  max: BbiUnit | null;
  aboveLimit: number;
  covered: number;
  median: number | null;
  mean: number | null;
  min: BbiUnit | null;
  classCounts: Record<BbiClass, number>;
}

export function summarizeBbi(data: BbiRunwayData): BbiSummary {
  const covered = data.units.filter((u) => u.governing);
  const sorted = covered.map((u) => (u.governing as NonNullable<BbiUnit["governing"]>).bbi).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const by = (better: (a: number, b: number) => boolean) =>
    covered.reduce<BbiUnit | null>((best, u) => (!best || better(u.governing!.bbi, best.governing!.bbi) ? u : best), null);
  const classCounts = Object.fromEntries(BBI_CLASSES.map((c) => [c, 0])) as Record<BbiClass, number>;
  for (const u of data.units) classCounts[classifyBbi(u.governing?.bbi ?? null, u.governing?.zone ?? null)]++;
  return {
    max: by((a, b) => a > b),
    aboveLimit: sorted.filter((v) => v > BBI_LIMIT).length,
    covered: covered.length,
    median: sorted.length === 0 ? null : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    mean: sorted.length === 0 ? null : sorted.reduce((s, v) => s + v, 0) / sorted.length,
    min: by((a, b) => a < b),
    classCounts,
  };
}

/** Jarak dari ambang 06 titik ke-i sebuah garis. */
export const traceX = (t: BbiLineTrace, i: number): number => t.x0_from_06_m + i * t.dx_m;

/** Indeks titik terdekat pada x, atau null kalau x di luar jangkauan garis (toleransi setengah jarak titik). */
export function traceIndexAtX(t: BbiLineTrace, x: number): number | null {
  const i = Math.round((x - t.x0_from_06_m) / t.dx_m);
  return i >= 0 && i < t.n ? i : null;
}

/** Nomor unit di x menurut unit_runs garis itu, atau null di luar jangkauan garis. */
export function unitAtX(t: BbiLineTrace, x: number): number | null {
  const i = traceIndexAtX(t, x);
  if (i === null) return null;
  return t.unit_runs.find(([, a, b]) => i >= a && i <= b)?.[0] ?? null;
}

/** Rentang x (naik) yang punya data pada garis ini. */
export function traceRange(t: BbiLineTrace): [number, number] {
  const a = traceX(t, 0);
  const b = traceX(t, t.n - 1);
  return a < b ? [a, b] : [b, a];
}

/** Maks per bin `binM` meter di dalam jendela; x = tengah bin. Puncak tidak hilang seperti pada pengambilan tiap-n titik. */
export function decimateMax(t: BbiLineTrace, domain: readonly [number, number], binM = 1): { x: number; bbi: number }[] {
  const bins = new Map<number, number>();
  for (let i = 0; i < t.n; i++) {
    const x = traceX(t, i);
    if (x < domain[0] || x > domain[1]) continue;
    const k = Math.floor(x / binM);
    const v = bins.get(k);
    if (v === undefined || t.bbi[i] > v) bins.set(k, t.bbi[i]);
  }
  return [...bins].sort((a, b) => a[0] - b[0]).map(([k, bbi]) => ({ x: (k + 0.5) * binM, bbi }));
}

/** Satu baris grafik: `x`, nilai tiap garis di kunci kode garis, dan titik flagged di kunci `f_<kode>`. */
export type BbiProfileRow = { x: number } & Record<string, number | null | undefined>;

/**
 * Baris recharts untuk garis-garis yang ditampilkan. Grafik punya satu sumbu x, jadi lebih dari satu garis
 * memakai kisi bersama (bin 1 m, atau 0,25 m di jendela sempit); satu garis di jendela sempit memakai x aslinya.
 * Titik flagged selalu punya baris dengan x aslinya, dan bagian tanpa data diisi baris kosong tiap 1 m supaya
 * tooltip tetap bisa menjelaskan kenapa kosong.
 */
export function profileRows(lines: BbiLineTrace[], domain: readonly [number, number]): BbiProfileRow[] {
  const raw = domain[1] - domain[0] <= PROFILE_RAW_WINDOW_M;
  const rows = new Map<number, BbiProfileRow>();
  const at = (x: number): BbiProfileRow => {
    let r = rows.get(x);
    if (!r) rows.set(x, (r = { x }));
    return r;
  };
  const gridX = (x: number) => (lines.length === 1 ? x : Math.round(x * 4) / 4);
  for (const t of lines) {
    if (!raw) {
      for (const p of decimateMax(t, domain)) at(p.x)[t.line] = p.bbi;
    } else {
      for (let i = 0; i < t.n; i++) {
        const x = traceX(t, i);
        if (x >= domain[0] && x <= domain[1]) at(gridX(x))[t.line] = t.bbi[i];
      }
    }
    for (const f of t.flagged) {
      const x = traceX(t, f.i);
      if (x >= domain[0] && x <= domain[1]) at(gridX(x))[`f_${t.line}`] = t.bbi[f.i];
    }
  }
  // Baris titik flagged di jendela lebar ikut memuat nilai bin-nya, supaya tooltip di sana tidak menampilkan garis kosong.
  if (!raw) {
    for (const r of rows.values()) {
      const bin = rows.get(Math.floor(r.x) + 0.5);
      for (const t of lines) if (r[t.line] === undefined && bin?.[t.line] !== undefined) r[t.line] = bin[t.line];
    }
  }
  const ranges = lines.map(traceRange);
  const lo = Math.min(...ranges.map((r) => r[0]));
  const hi = Math.max(...ranges.map((r) => r[1]));
  for (let k = Math.floor(domain[0]); k < domain[1]; k++) {
    const x = k + 0.5;
    if (x < lo || x > hi) at(x);
  }
  return [...rows.values()].sort((a, b) => a.x - b.x);
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
