// src/lib/skid-trace.ts — hitungan untuk data per meter. Tanpa React dan tanpa `ol`, supaya bisa diuji dengan node --test.
import { classifySkid, FAA_320_ADJACENT, SKID_REPEATABILITY_MU, SKID_SEGMENT_M, SKID_THRESHOLDS } from "../config/skid.ts";
import type { SkidClass } from "../config/skid.ts";
import type { SkidLaneTrace, SkidRunwayTrace } from "../types/skid.ts";

// ---------------------------------------------------------------- posisi

/** DISTANCE (m dari awal rekaman, seperti di layar alat) untuk bacaan ke-i. */
export const distanceOf = (t: SkidLaneTrace, i: number): number => t.d_first + i;

/** Stasiun (m dari tepi luar unit 1) untuk bacaan ke-i. Aturan yang sama dengan berkas per unit. */
export const stationOf = (t: SkidLaneTrace, i: number): number => t.s0_m - (t.d_first + i);

/** x = jarak dari ujung runway tempat uji dimulai (ujung 06 / 07L), searah uji. Dipakai sebagai sumbu x grafik. */
export const xOfStation = (rt: SkidRunwayTrace, station: number): number => rt.unit_bounds.last_end_m - station;
export const xOf = (rt: SkidRunwayTrace, t: SkidLaneTrace, i: number): number => xOfStation(rt, stationOf(t, i));

/** Indeks bacaan terdekat dengan x, atau null di luar rekaman lajur itu. */
export function indexAtX(rt: SkidRunwayTrace, t: SkidLaneTrace, x: number): number | null {
  const i = Math.round(x - (rt.unit_bounds.last_end_m - t.s0_m) - t.d_first);
  return i >= 0 && i < t.mu.length ? i : null;
}

/** Nomor unit (1..N) yang memuat stasiun, atau null. Batas presisi penuh dari unit_bounds. */
export function unitAtStation(rt: SkidRunwayTrace, station: number): number | null {
  const s = rt.unit_bounds.starts_m;
  if (station < s[0] || station >= rt.unit_bounds.last_end_m) return null;
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid] <= station) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Rentang x satu unit: [x awal, x akhir). Unit bernomor besar ada di x kecil. */
export function unitXRange(rt: SkidRunwayTrace, unit: number): [number, number] {
  const s = rt.unit_bounds.starts_m;
  const start = s[unit - 1];
  const end = unit < s.length ? s[unit] : rt.unit_bounds.last_end_m;
  return [xOfStation(rt, end), xOfStation(rt, start)];
}

/** Indeks bacaan satu lajur yang masuk ke unit (biasanya 9–11 bacaan), urut menurut DISTANCE. */
export function indicesInUnit(rt: SkidRunwayTrace, t: SkidLaneTrace, unit: number): number[] {
  const [x0, x1] = unitXRange(rt, unit);
  if (x1 < xOf(rt, t, 0) - 1 || x0 > xOf(rt, t, t.mu.length - 1) + 1) return []; // unit di luar rekaman
  const a = indexAtX(rt, t, x0);
  const b = indexAtX(rt, t, x1);
  const from = Math.max(0, (a ?? 0) - 2);
  const to = Math.min(t.mu.length - 1, (b ?? t.mu.length - 1) + 2);
  const out: number[] = [];
  for (let i = from; i <= to; i++) if (unitAtStation(rt, stationOf(t, i)) === unit) out.push(i);
  return out;
}

// ---------------------------------------------------------------- rata-rata

/** Rata-rata bergerak terpusat ±half bacaan (half = 76 → 153 bacaan ≈ 152,4 m). Bacaan null dilewati. */
export function movingAverage(mu: readonly (number | null)[], half = 76): { mean: (number | null)[]; n: number[] } {
  const N = mu.length;
  const ps = new Float64Array(N + 1);
  const pc = new Int32Array(N + 1);
  for (let i = 0; i < N; i++) {
    const v = mu[i];
    ps[i + 1] = ps[i] + (v ?? 0);
    pc[i + 1] = pc[i] + (v === null ? 0 : 1);
  }
  const mean: (number | null)[] = new Array(N);
  const n: number[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(N - 1, i + half);
    const c = pc[b + 1] - pc[a];
    n[i] = c;
    mean[i] = c ? (ps[b + 1] - ps[a]) / c : null;
  }
  return { mean, n };
}

const SCALE = 10000; // stasiun dibandingkan sebagai bilangan bulat 0,1 mm
const HALF_WINDOW = 762000; // 76,2 m

/** μ 152 m satu unit dihitung ulang dari data per meter dengan aturan berkas per unit (untuk uji G).
 *  edge = true kalau ada bacaan tepat di tepi jendela (lihat brief §3.6). */
export function unitWindowMean(rt: SkidRunwayTrace, t: SkidLaneTrace, unit: number): { mean: number | null; n: number; edge: boolean } {
  const s0 = Math.round(t.s0_m * SCALE);
  const wm = Math.round(rt.unit_bounds.window_mid_m[unit - 1] * SCALE);
  const lo = wm - HALF_WINDOW;
  const hi = wm + HALF_WINDOW;
  const dMax = Math.floor((s0 - lo) / SCALE); // stasiun >= lo
  const dMin = Math.floor((s0 - hi) / SCALE) + 1; // stasiun < hi
  const dLast = t.d_first + t.mu.length - 1;
  let sum = 0;
  let n = 0;
  for (let d = Math.max(dMin, t.d_first); d <= Math.min(dMax, dLast); d++) {
    const v = t.mu[d - t.d_first];
    if (v !== null) { sum += v; n++; }
  }
  const onEdge = (e: number) => {
    const r = (((s0 - e) % SCALE) + SCALE) % SCALE;
    const d = (s0 - e) / SCALE;
    return r === 0 && d >= t.d_first && d <= dLast;
  };
  return { mean: n ? sum / n : null, n, edge: onEdge(lo) || onEdge(hi) };
}

/** n dan μ 10 m satu unit dihitung ulang dari data per meter (untuk uji G dan panel unit). */
export function unitMeanFromTrace(rt: SkidRunwayTrace, t: SkidLaneTrace, unit: number): { n: number; mean: number | null } {
  const idx = indicesInUnit(rt, t, unit);
  const vals = idx.map((i) => t.mu[i]).filter((v): v is number => v !== null);
  return { n: idx.length, mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
}

// ---------------------------------------------------------------- segmen seperti printout alat

export interface SkidSegment {
  index: number;
  dFrom: number;            // DISTANCE pertama di segmen
  dTo: number;              // DISTANCE terakhir di segmen
  lengthM: number;          // panjang segmen (segmen terakhir bisa lebih pendek)
  partial: boolean;         // lebih pendek dari panjang penuh
  n: number;                // jumlah bacaan bernilai
  mean: number | null;
  meanSpeed: number | null;
}

function segmentStats(t: SkidLaneTrace, index: number, a: number, b: number, fullLength: number): SkidSegment {
  // segmen memuat DISTANCE d dengan a < d <= b
  const dLast = t.d_first + t.mu.length - 1;
  const dFrom = Math.max(t.d_first, Math.floor(a + 1e-9) + 1);
  const dTo = Math.min(dLast, Math.floor(b + 1e-9));
  let s = 0, n = 0, sv = 0, nv = 0;
  for (let d = dFrom; d <= dTo; d++) {
    const v = t.mu[d - t.d_first];
    const sp = t.speed_kmh[d - t.d_first];
    if (v !== null) { s += v; n++; }
    if (sp !== null) { sv += sp; nv++; }
  }
  const lengthM = Math.min(b, dLast) - a;
  return { index, dFrom, dTo, lengthM, partial: lengthM < fullLength - 1e-6, n, mean: n ? s / n : null, meanSpeed: nv ? sv / nv : null };
}

/** Segmen tetap dari awal rekaman: segmen j memuat DISTANCE d dengan j·len < d ≤ (j+1)·len. */
export function fixedSegments(t: SkidLaneTrace, len = SKID_SEGMENT_M): SkidSegment[] {
  const dLast = t.d_first + t.mu.length - 1;
  const out: SkidSegment[] = [];
  for (let j = 0; j * len < dLast - 1e-9; j++) out.push(segmentStats(t, j, j * len, (j + 1) * len, len));
  return out;
}

/** Sepertiga panjang rekaman (Lampiran 3 par. 1.a(3)). */
export function thirds(t: SkidLaneTrace): SkidSegment[] {
  const L = t.mu.length;
  return [0, 1, 2].map((j) => segmentStats(t, j, (j * L) / 3, ((j + 1) * L) / 3, L / 3));
}

// ---------------------------------------------------------------- FAA par. 3-20 (alat bantu, bukan penilaian resmi)

export type Faa320Status = "immediate" | "extensive" | "belowMinimum" | "monitor" | "ok" | "noData";

export interface Faa320Result {
  status: Faa320Status;
  borderline: boolean; // dalam ±0,06 dari ambang minimum atau maintenance planning
}

/** Penilaian par. 3-20 per segmen 152,4 m yang berurutan dalam satu run.
 *  immediate    = 3-20.c: < minimum DAN segmen tetangga < maintenance planning
 *                 (adjacent = "all": semua tetangga; "any": cukup satu tetangga)
 *  extensive    = 3-20.b: < maintenance planning sepanjang ≥ 304,8 m (1000 ft) berturut-turut
 *  belowMinimum = < minimum tetapi syarat 3-20.c dan 3-20.b tidak terpenuhi
 *  monitor      = 3-20.a: < maintenance planning satu segmen saja, tetangga ≥ maintenance planning
 */
export function evaluateFaa320(
  segs: readonly Pick<SkidSegment, "mean" | "lengthM">[],
  th = SKID_THRESHOLDS,
  adjacent: "all" | "any" = FAA_320_ADJACENT,
): Faa320Result[] {
  const below = segs.map((s) => s.mean !== null && s.mean < th.maintenancePlanning);
  const runLength = new Array<number>(segs.length).fill(0);
  for (let j = 0; j < segs.length; ) {
    if (!below[j]) { j++; continue; }
    let k = j;
    let len = 0;
    while (k < segs.length && below[k]) { len += segs[k].lengthM; k++; }
    for (let q = j; q < k; q++) runLength[q] = len;
    j = k;
  }
  return segs.map((s, j) => {
    const m = s.mean;
    if (m === null) return { status: "noData", borderline: false };
    const near = (x: number) => Math.abs(m - x) <= SKID_REPEATABILITY_MU + 1e-9;
    const borderline = near(th.minimum) || near(th.maintenancePlanning);
    const neighbours = [segs[j - 1]?.mean, segs[j + 1]?.mean].filter((x): x is number => typeof x === "number");
    const nbBelow = (x: number) => x < th.maintenancePlanning;
    const adjacentOk = adjacent === "all" ? neighbours.every(nbBelow) : neighbours.some(nbBelow);
    let status: Faa320Status = "ok";
    if (m < th.minimum && neighbours.length > 0 && adjacentOk) status = "immediate";
    else if (m < th.maintenancePlanning && runLength[j] >= 2 * SKID_SEGMENT_M - 1e-6) status = "extensive";
    else if (m < th.minimum) status = "belowMinimum";
    else if (m < th.maintenancePlanning) status = "monitor";
    return { status, borderline };
  });
}

// ---------------------------------------------------------------- data grafik dan heatmap per meter

/** Kunci kolom per lajur tanpa titik: recharts membaca dataKey "lo_L3.0" sebagai path "lo_L3" → "0". */
export const laneKey = (lane: string): string => lane.replace(".", "_");

export interface ProfileRow { x: number; [key: string]: number | null }

/** Baris data bersama untuk grafik (dan heatmap per meter) pada rentang x yang terlihat.
 *  Lebar ember = max(1 m, rentang / maxRows). Untuk tiap lajur:
 *    lo_<lajur>, hi_<lajur> = bacaan 1 m terendah/tertinggi di ember (sama kalau ember = 1 m),
 *    ma_<lajur>             = rata-rata bergerak 152 m di bacaan terdekat titik tengah ember,
 *    v_<lajur>              = rata-rata kecepatan di ember.
 *  Nilai terendah dan tertinggi selalu ikut, jadi lembah karet tidak hilang saat grafik diperkecil.
 *  Di grid bersama, tiap lajur bergeser < 1 m dari posisi aslinya — tidak terlihat dan tidak mengubah angka. */
export function profileRows(
  rt: SkidRunwayTrace,
  lanes: readonly SkidLaneTrace[],
  domain: readonly [number, number],
  maxRows: number,
  ma: ReadonlyMap<string, readonly (number | null)[]> = new Map(),
): ProfileRow[] {
  const [x0, x1] = domain;
  const step = Math.max(1, (x1 - x0) / Math.max(1, maxRows));
  const start = step === 1 ? Math.floor(x0) : x0;
  const rows: ProfileRow[] = [];
  for (let xa = start; xa < x1 - 1e-9; xa += step) {
    const xb = xa + step;
    const row: ProfileRow = { x: step === 1 ? xa : (xa + xb) / 2 };
    for (const t of lanes) {
      const c = rt.unit_bounds.last_end_m - t.s0_m + t.d_first; // x bacaan i = c + i
      const i0 = Math.max(0, Math.ceil(xa - c - 1e-9));
      const i1 = Math.min(t.mu.length - 1, Math.ceil(xb - c - 1e-9) - 1);
      let lo: number | null = null;
      let hi: number | null = null;
      let vs = 0;
      let vn = 0;
      for (let i = i0; i <= i1; i++) {
        const v = t.mu[i];
        if (v !== null) {
          if (lo === null || v < lo) lo = v;
          if (hi === null || v > hi) hi = v;
        }
        const sp = t.speed_kmh[i];
        if (sp !== null) { vs += sp; vn++; }
      }
      const k = laneKey(t.lane);
      row[`lo_${k}`] = lo;
      row[`hi_${k}`] = hi;
      row[`v_${k}`] = vn ? vs / vn : null;
      const m = ma.get(t.lane);
      const iMid = step === 1 ? i0 : Math.min(i1, Math.max(i0, Math.round(row.x - c)));
      row[`ma_${k}`] = m && i1 >= i0 ? m[iMid] : null;
    }
    rows.push(row);
  }
  return rows;
}

/** Potongan bacaan berurutan dengan kelas yang sama — dipakai untuk garis lajur per meter di peta. */
export interface MeterRun { cls: SkidClass; iFrom: number; iTo: number }

export function meterRuns(values: readonly (number | null)[]): MeterRun[] {
  const out: MeterRun[] = [];
  for (let i = 0; i < values.length; i++) {
    const cls = classifySkid(values[i]);
    const last = out[out.length - 1];
    if (last && last.cls === cls && last.iTo === i - 1) last.iTo = i;
    else out.push({ cls, iFrom: i, iTo: i });
  }
  return out;
}

// ---------------------------------------------------------------- tooltip: bacaan yang digambar di sebuah sel

/** Index of the 1 m reading drawn in the profile / heatmap cell at x, or null outside the recording.
 *  profileRows puts reading i in the cell [floor(x), floor(x)+1) when cells are 1 m wide (and the cell is
 *  the lowest of its readings when wider), so tooltips must use the same bucketing: plain "nearest
 *  reading" can differ by one reading from the one whose value the cell shows. `step` is the cell width in m. */
export function readingAtX(rt: SkidRunwayTrace, lane: SkidLaneTrace, x: number, step: number): number | null {
  const c = rt.unit_bounds.last_end_m - lane.s0_m + lane.d_first; // x of reading i is c + i
  const i = step === 1 ? Math.ceil(Math.floor(x) - c - 1e-9) : Math.round(x - c);
  return i >= 0 && i < lane.mu.length ? i : null;
}

// ---------------------------------------------------------------- tanda tiap 100 ft (printout alat)

export interface FeetMark { x: number; feet: number }

/** Marks every 100 ft (30.48 m) of DISTANCE from the start of recording, as on the device printout
 *  (FAA AC 150/5320-12C App. 3 par. 1.a(9)), that fall inside `domain` and inside the recording. */
export function feetMarks(rt: SkidRunwayTrace, lane: SkidLaneTrace, domain: readonly [number, number]): FeetMark[] {
  const step = 30.48;
  const base = rt.unit_bounds.last_end_m - lane.s0_m; // x of DISTANCE d is base + d
  const lastD = lane.d_first + lane.mu.length - 1;
  const out: FeetMark[] = [];
  const from = Math.max(1, Math.ceil((domain[0] - base) / step));
  const to = Math.min(Math.floor((domain[1] - base) / step), Math.floor(lastD / step));
  for (let k = from; k <= to; k++) out.push({ x: base + k * step, feet: k * 100 });
  return out;
}
