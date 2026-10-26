// src/lib/skid-import.ts — Moventor Skiddometer CSV -> berkas per unit + berkas per meter (admin upload).
// Modul murni: tanpa React, tanpa `ol`, tanpa akses berkas. Seed dan tabel stasiun dikirim sebagai argumen,
// jadi modul yang sama jalan di browser dan di `node --test`.
// Aturan hitung IDENTIK dengan scripts/skid/build-skid-1m.mjs (oracle uji T3/T5). Jangan diubah supaya uji lulus.
import { LANE_ORDER, SKID_SPEED } from "../config/skid.ts";
import type {
  LaneCode, RunwayId, SkidLaneMeta, SkidLaneTrace, SkidRunwayData, SkidRunwayTrace, SkidUnit,
} from "../types/skid.ts";

const SCALE = 10000; // 1 satuan stasiun = 0,1 mm
const HALF_WINDOW = 762000; // 76,2 m
const R_EARTH = 6371008.8;
export const MIN_GPS_ROWS = 10;
const GPS_SLOPE_MAX = 0.05;
const LATERAL_MAX_M = 1.5;
const SPAN_MAX_H = 12;

export interface StationTable {
  runways: Record<RunwayId, { starts_m: number[]; last_end_m: number; window_mid_m: number[] }>;
}

export interface Issue { code: string; message: string; file?: string }

// ---------------------------------------------------------------- helpers

const median = (a: number[]): number | null => {
  if (a.length === 0) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// toFixed rounds the exact binary value (like Python round, which made the seed files); Math.round(x * 10^n) would round 0.86275 up.
const round = (x: number | null, n: number): number | null => (x === null ? null : Number(x.toFixed(n)));
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

function lastLE(arr: number[], x: number): number {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** UTC ISO tanpa milidetik -> "YYYY-MM-DD HH:mm" di WIB (UTC+7). */
export function toWib(utcIso: string): string {
  const d = new Date(Date.parse(utcIso) + 7 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
const isoUtc = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

// ---------------------------------------------------------------- parser

export interface MoventorRow { d: number; mu: number | null; speed: number | null; time: string; lat: number | null; lon: number | null; marker: string }

export interface ParsedMoventor {
  meta: { section: string; key: string; value: string }[];
  rows: MoventorRow[];
  endOfData: boolean;
  delimiter: "," | ";";
  startUtc: string; // ISO dari DATE + TIME + TIME ZONE header; "" kalau tidak terbaca
  runwayDirection: string | null;
  surfaceName: string | null;
  resolutionM: number | null;
  wetting: string | null;
}

/** Galat yang menghentikan pembacaan satu berkas. */
export function importError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function toNumber(s: string | undefined | null, decimalComma = false): number | null {
  if (s === undefined || s === null) return null;
  let t = String(s).trim();
  if (t === "" || /^(nan|n\/a|na|null|-)$/i.test(t)) return null;
  if (decimalComma) t = t.replace(",", ".");
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function metaValue(meta: ParsedMoventor["meta"], key: string, preferSection?: string): string | null {
  const k = key.toUpperCase();
  const hits = meta.filter((m) => m.key.toUpperCase() === k);
  if (hits.length === 0) return null;
  const pref = preferSection ? hits.find((m) => m.section.toUpperCase() === preferSection.toUpperCase()) : null;
  return (pref ?? hits[hits.length - 1]).value;
}

const POSITION_RE = /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/;

/** Tanggal+jam header dikurangi offset zona waktu -> ISO UTC. */
function headerStartUtc(meta: ParsedMoventor["meta"]): string {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(metaValue(meta, "DATE") ?? "");
  const time = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(metaValue(meta, "TIME") ?? "");
  if (!date || !time) return "";
  const tz = /UTC\s*([+-])(\d{1,2}):?(\d{2})?/i.exec(metaValue(meta, "TIME ZONE") ?? "");
  const offMin = tz ? (tz[1] === "-" ? -1 : 1) * (Number(tz[2]) * 60 + Number(tz[3] ?? 0)) : 0;
  const local = Date.UTC(+date[1], +date[2] - 1, +date[3], +time[1], +time[2], +time[3]);
  return isoUtc(local - offMin * 60_000);
}

/** Membaca satu ekspor Moventor. Melempar galat ber-`code` kalau tata letak tidak dikenali. */
export function parseMoventorCsv(text: string): ParsedMoventor {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let h = -1;
  let delim: "," | ";" = ",";
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const d = l.includes(",") ? "," : l.includes(";") ? ";" : ",";
    const c = splitCsvLine(l, d);
    if (/^DISTANCE\b/i.test(c[0] ?? "") && c.some((x) => /^FRICTION\b/i.test(x))) { h = i; delim = d; break; }
  }
  if (h < 0) throw importError("no-header", "Bukan ekspor Moventor: baris judul DISTANCE/FRICTION tidak ditemukan.");
  const decimalComma = delim === ";";

  const meta: ParsedMoventor["meta"] = [];
  let section = "";
  for (const l of lines.slice(0, h)) {
    if (l.trim() === "") continue;
    const c = splitCsvLine(l, delim);
    if (c.length === 1 && c[0] !== "") { section = c[0]; continue; }
    if (c.length >= 2 && c[0] !== "") meta.push({ section, key: c[0], value: c[1] });
  }

  const head = splitCsvLine(lines[h], delim).map((x) => x.toUpperCase());
  const col = (re: RegExp) => head.findIndex((x) => re.test(x));
  const iD = col(/^DISTANCE/), iF = col(/^FRICTION/), iS = col(/^SPEED/), iT = col(/^TIME/);
  const iP = col(/^POSITION/), iM = col(/^MARKER/), iLat = col(/^LAT/), iLon = col(/^LON/);
  if (iS < 0) throw importError("no-header", "Bukan ekspor Moventor: kolom SPEED tidak ditemukan.");

  const rows: MoventorRow[] = [];
  let endOfData = false;
  for (let i = h + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/END OF DATA/i.test(l)) { endOfData = true; break; }
    if (l.trim() === "") continue;
    const c = splitCsvLine(l, delim);
    if ((c[iD] ?? "") === "") continue;
    const d = toNumber(c[iD], decimalComma);
    if (d === null) throw importError("distance-gap", `DISTANCE tidak berurutan mulai baris ${i + 1}.`);
    let lat: number | null = null, lon: number | null = null;
    if (iP >= 0) {
      const p = POSITION_RE.exec(c[iP] ?? "");
      if (p) { lat = toNumber(p[1], true); lon = toNumber(p[2], true); }
    } else if (iLat >= 0 && iLon >= 0) {
      lat = toNumber(c[iLat], decimalComma); lon = toNumber(c[iLon], decimalComma);
    }
    if (lat === null || lon === null || (Math.abs(lat) < 1e-9 && Math.abs(lon) < 1e-9)) { lat = null; lon = null; }
    rows.push({
      d, mu: toNumber(c[iF], decimalComma), speed: toNumber(c[iS], decimalComma),
      time: iT >= 0 ? (c[iT] ?? "") : "", lat, lon, marker: iM >= 0 ? (c[iM] ?? "") : "",
    });
  }
  return {
    meta, rows, endOfData, delimiter: delim,
    startUtc: headerStartUtc(meta),
    runwayDirection: metaValue(meta, "RUNWAY DIRECTION"),
    surfaceName: metaValue(meta, "NAME", "SURFACE"),
    resolutionM: toNumber(metaValue(meta, "RESOLUTION (m)")),
    wetting: metaValue(meta, "WETTING"),
  };
}

// ---------------------------------------------------------------- deteksi nama berkas

export function runwayFromName(name: string): RunwayId | null {
  const n = name.replace(/_/g, " ").toUpperCase();
  if (/0?7\s*L\s*-\s*25\s*R/.test(n)) return "07L-25R";
  if (/(^|[^0-9])0?6\s*-\s*24([^0-9]|$)/.test(n)) return "06-24";
  return null;
}

/** Nama yang tersanitasi ("1_5_m_Left") dipulihkan jadi "1.5 m Left" sebelum dicocokkan. */
export function laneFromName(name: string): LaneCode | null {
  const n = name.replace(/_/g, " ").replace(/(\d+)\s+(\d)\s*m\s*(left|right|kiri|kanan)\b/gi, "$1.$2 m $3");
  const m = n.match(/(\d+(?:[.,]\d+)?)\s*m\s*(left|right|kiri|kanan)\b/i);
  if (!m) return null;
  const off = Number(m[1].replace(",", "."));
  const code = `${/^(left|kiri)$/i.test(m[2]) ? "L" : "R"}${off.toFixed(1)}`;
  return LANE_ORDER.find((l) => l === code) ?? null;
}

const runwayFromDirection = (dir: string | null): RunwayId | "reverse" | null => {
  const d = (dir ?? "").trim().toUpperCase();
  if (/^0?6$/.test(d)) return "06-24";
  if (/^0?7L$/.test(d)) return "07L-25R";
  if (/^(24|25R)$/.test(d)) return "reverse";
  return null;
};

const laneSide = (l: LaneCode) => l[0] as "L" | "R";
const laneOffset = (l: LaneCode) => (l[0] === "L" ? -1 : 1) * Number(l.slice(1));

// ---------------------------------------------------------------- pemeriksaan satu berkas

export interface FileStats {
  rows: number;
  muNull: number;
  speedNull: number;
  heldRows: number;
  gpsRows: number;
  meanMu: number | null;
  meanSpeed: number | null;
  minSpeed: number | null;
  maxSpeed: number | null;
  outsideSpeed: number;
  startWib: string;
}

export interface InspectedFile {
  name: string;
  parsed: ParsedMoventor | null;
  detected: { runway: RunwayId | null; lane: LaneCode | null };
  runway: RunwayId | null; // efektif: koreksi admin, kalau tidak ada hasil deteksi
  lane: LaneCode | null;
  stats: FileStats | null;
  errors: Issue[];
  warnings: Issue[];
}

export function fileStats(p: ParsedMoventor): FileStats {
  const mu = p.rows.map((r) => r.mu), sp = p.rows.map((r) => r.speed);
  const muV = mu.filter((x): x is number => x !== null), spV = sp.filter((x): x is number => x !== null);
  let held = 0;
  for (let i = 1; i < p.rows.length; i++) {
    if (mu[i] !== null && mu[i] === mu[i - 1] && sp[i] !== null && sp[i] === sp[i - 1]) held++;
  }
  return {
    rows: p.rows.length,
    muNull: p.rows.length - muV.length,
    speedNull: p.rows.length - spV.length,
    heldRows: held,
    gpsRows: p.rows.filter((r) => r.lat !== null).length,
    meanMu: mean(muV),
    meanSpeed: mean(spV),
    minSpeed: spV.length ? Math.min(...spV) : null,
    maxSpeed: spV.length ? Math.max(...spV) : null,
    outsideSpeed: spV.filter((v) => Math.abs(v - SKID_SPEED.target) > SKID_SPEED.tol).length,
    startWib: p.startUtc ? toWib(p.startUtc) : "",
  };
}

const decimalsOf = (s: string) => { const m = s.trim().match(/\.(\d+)$/); return m ? m[1].length : 0; };

/** Membaca satu berkas dan menjalankan semua pemeriksaan yang hanya butuh berkas itu (§6). */
export function inspectFile(name: string, text: string, override: { runway?: RunwayId | null; lane?: LaneCode | null } = {}): InspectedFile {
  const detected = { runway: runwayFromName(name), lane: laneFromName(name) };
  const out: InspectedFile = {
    name, parsed: null, detected,
    runway: override.runway ?? detected.runway, lane: override.lane ?? detected.lane,
    stats: null, errors: [], warnings: [],
  };
  const err = (code: string, message: string) => out.errors.push({ code, message, file: name });
  const warn = (code: string, message: string) => out.warnings.push({ code, message, file: name });

  let p: ParsedMoventor;
  try { p = parseMoventorCsv(text); } catch (e) {
    err((e as { code?: string }).code ?? "no-header", (e as Error).message);
    return out;
  }
  out.parsed = p;
  const st = (out.stats = fileStats(p));

  if (p.rows.length === 0) { err("empty", "Berkas tidak berisi data."); return out; }
  if (!p.startUtc) err("no-date", "Tanggal/jam di header (DATE, TIME) tidak terbaca.");
  const bad = p.rows.findIndex((r, i) => Math.abs(r.d - (i + 1)) > 1e-9);
  if (bad >= 0) err("distance-gap", `DISTANCE tidak berurutan mulai baris ${bad + 1}.`);
  if (p.resolutionM !== null && p.resolutionM !== 1) err("resolution", `Resolusi ${p.resolutionM} m; hanya 1 m yang didukung.`);

  // runway: nama berkas (atau koreksi admin) dicocokkan dengan header
  const dir = runwayFromDirection(p.runwayDirection);
  const surf = p.surfaceName ? runwayFromName(p.surfaceName) : null;
  if (dir === "reverse") err("reverse-direction", "Arah uji 24/25R belum didukung.");
  if (!out.runway) err("runway-unknown", "Runway tidak terbaca dari nama berkas. Pilih manual.");
  else if (dir !== "reverse") {
    const claims: [string, RunwayId | null][] = [["header RUNWAY DIRECTION", dir], ["header SURFACE NAME", surf]];
    if (!override.runway) claims.unshift(["nama berkas", detected.runway]);
    const seen = claims.filter((c): c is [string, RunwayId] => c[1] !== null && c[1] !== out.runway);
    if (seen.length) err("runway-mismatch", `Runway dipilih ${out.runway}, tetapi ${seen.map(([k, v]) => `${k} menyebut ${v}`).join(", ")}.`);
  }
  if (!out.lane) err("lane-unknown", "Lajur tidak terbaca dari nama berkas. Pilih manual.");

  if (!p.endOfData) warn("no-end-marker", 'Tidak ada baris "END OF DATA"; dibaca sampai akhir berkas.');
  const len = toNumber(metaValue(p.meta, "LENGTH"));
  if (len !== null && Math.round(len) !== p.rows.length) warn("length-mismatch", `LENGTH header ${len}, jumlah baris ${p.rows.length}.`);
  const statF = metaValue(p.meta, "FRICTION", "STATISTICS");
  if (statF !== null && toNumber(statF, p.delimiter === ";") !== null && st.meanMu !== null) {
    const tol = 0.5 * 10 ** -decimalsOf(statF) + 1e-9;
    if (Math.abs((toNumber(statF, p.delimiter === ";") as number) - st.meanMu) > tol)
      warn("stat-mismatch", `FRICTION header ${statF} berbeda dari rata-rata baris ${round(st.meanMu, 5)}.`);
  }
  if (st.outsideSpeed > 0) warn("speed", `${st.outsideSpeed} baris di luar ${SKID_SPEED.target} ± ${SKID_SPEED.tol} km/j.`);
  if (p.wetting !== null && p.wetting.trim().toLowerCase() !== "on") warn("wetting-off", `WETTING "${p.wetting}": uji kering tidak sebanding dengan ambang FAA.`);
  if (p.delimiter === ";") warn("semicolon", "Pemisah ';' — berkas kemungkinan pernah disimpan ulang di Excel.");
  return out;
}

// ---------------------------------------------------------------- penempatan per meter -> unit

interface StationIdx { startsI: number[]; lastEndI: number; wmI: number[]; n: number }

function stationIdx(st: StationTable["runways"][RunwayId]): StationIdx {
  return {
    startsI: [...st.starts_m].reverse().map((x) => x * SCALE),
    lastEndI: st.last_end_m * SCALE,
    wmI: [...st.window_mid_m].reverse().map((x) => Math.round(x * SCALE)),
    n: st.starts_m.length,
  };
}

/** Hasil per unit dalam URUTAN STASIUN (indeks 0 = stasiun terkecil = unit N). */
function placeLane(mu: (number | null)[], s0: number, S: StationIdx) {
  const L = mu.length;
  const s0I = Math.round(s0 * SCALE);
  const ps = new Float64Array(L + 1), pc = new Int32Array(L + 1);
  for (let i = 0; i < L; i++) {
    ps[i + 1] = ps[i] + (mu[i] ?? 0);
    pc[i + 1] = pc[i] + (mu[i] === null ? 0 : 1);
  }
  const nRows = new Int32Array(S.n), sum = new Float64Array(S.n), cnt = new Int32Array(S.n);
  for (let i = 0; i < L; i++) {
    const sI = s0I - (i + 1) * SCALE;
    if (sI < S.startsI[0] || sI >= S.lastEndI) continue;
    const k = lastLE(S.startsI, sI);
    nRows[k]++;
    if (mu[i] !== null) { sum[k] += mu[i] as number; cnt[k]++; }
  }
  const mu10: (number | null)[] = [], mu152: (number | null)[] = [];
  for (let k = 0; k < S.n; k++) {
    const m10 = cnt[k] ? sum[k] / cnt[k] : null;
    mu10.push(m10);
    if (m10 === null) { mu152.push(null); continue; }
    const lo = S.wmI[k] - HALF_WINDOW, hi = S.wmI[k] + HALF_WINDOW;
    const dMax = Math.floor((s0I - lo) / SCALE);
    const dMin = Math.floor((s0I - hi) / SCALE) + 1;
    const a = Math.max(1, dMin), b = Math.min(L, dMax);
    const c = b < a ? 0 : pc[b] - pc[a - 1];
    mu152.push(c ? (ps[b] - ps[a - 1]) / c : null);
  }
  return { n: Array.from(nRows), mu10, mu152 };
}

/** Sumbu runway lokal dari centroid unit seed (untuk proyeksi GPS). Salinan makeAxis di build-skid-1m.mjs. */
function makeAxis(seedUnits: SkidUnit[]) {
  const Us = [...seedUnits].reverse(); // urutan stasiun
  const c1 = Us[0].centroid_lonlat, cN = Us[Us.length - 1].centroid_lonlat;
  const cosLat = Math.cos((c1[1] * Math.PI) / 180);
  const xy = (lon: number, lat: number): [number, number] => [((lon - c1[0]) * Math.PI / 180) * R_EARTH * cosLat, ((lat - c1[1]) * Math.PI / 180) * R_EARTH];
  const pN = xy(cN[0], cN[1]);
  const len = Math.hypot(pN[0], pN[1]);
  const t = [-pN[0] / len, -pN[1] / len];
  const left = [-t[1], t[0]];
  const mid1 = Us[0].station_mid_m;
  return (lon: number, lat: number) => {
    const p = xy(lon, lat);
    return { station: mid1 - (p[0] * t[0] + p[1] * t[1]), offset: -(p[0] * left[0] + p[1] * left[1]) };
  };
}

// ---------------------------------------------------------------- satu runway

export type S0Source = "median proyeksi GPS" | "median s0 lajur lain (tanpa GPS)" | "diisi manual";

export interface LaneAnalysis {
  file: string;
  lane: LaneCode;
  gpsRows: number;
  s0Auto: number | null;   // dari GPS; null kalau lajur tanpa GPS (belum pakai median lajur lain)
  s0: number | null;       // yang dipakai
  s0Source: S0Source | null;
  slope: number | null;
  iqr: number | null;
  lateral: number | null;
  lateralResidual: number | null;
}

export interface BuildOptions {
  s0?: Partial<Record<LaneCode, number>>; // s0 manual per lajur
  importedAt?: string;
  appVersion?: string;
  unitsFileName?: string;
}

export interface RunwayBuild {
  runway: RunwayId;
  errors: Issue[];
  warnings: Issue[];
  lanes: LaneAnalysis[];
  s0Mode: "gps" | "manual" | "mixed" | null;
  units?: SkidRunwayData;
  trace?: SkidRunwayTrace;
}

function quantile(a: number[], q: number) {
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Waktu baris terakhir sebagai ISO UTC; lewat tengah malam kalau jamnya lebih kecil dari jam header. */
function endUtcOf(p: ParsedMoventor): string {
  const t = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(metaValue(p.meta, "TIME") ?? "");
  const last = /^(\d{1,2}):(\d{2}):(\d{2})/.exec(p.rows[p.rows.length - 1]?.time ?? "");
  if (!t || !last) return p.startUtc;
  const sec = (m: RegExpExecArray) => +m[1] * 3600 + +m[2] * 60 + +m[3];
  let delta = sec(last) - sec(t);
  if (delta < 0) delta += 86400;
  return isoUtc(Date.parse(p.startUtc) + delta * 1000);
}

/**
 * Mengubah semua berkas satu runway (1..8 lajur, sudah lolos inspectFile) menjadi berkas per unit dan per meter.
 * `seed` = berkas per unit 2026 runway itu (geometri unit diambil dari sini); `stations` = tabel batas unit.
 * Kalau ada galat, `units` dan `trace` tidak diisi.
 */
export function buildRunway(files: InspectedFile[], runway: RunwayId, seed: SkidRunwayData, stations: StationTable, opts: BuildOptions = {}): RunwayBuild {
  const errors: Issue[] = [], warnings: Issue[] = [];
  const out: RunwayBuild = { runway, errors, warnings, lanes: [], s0Mode: null };
  const ok = files.filter((f): f is InspectedFile & { parsed: ParsedMoventor; lane: LaneCode } => f.parsed !== null && f.lane !== null && f.stats !== null);

  // lajur ganda
  const byLane = new Map<LaneCode, typeof ok>();
  for (const f of ok) byLane.set(f.lane, [...(byLane.get(f.lane) ?? []), f]);
  for (const [lane, fs] of byLane) {
    if (fs.length > 1) {
      const names = fs.map((f) => f.name).join(", ");
      for (const f of fs) errors.push({ code: "duplicate-lane", message: `${lane} RWY ${runway} ada di dua berkas: ${names}.`, file: f.name });
    }
  }
  if (errors.length) return out;

  const axis = makeAxis(seed.units);
  const lanes: LaneAnalysis[] = ok.map((f) => {
    const gpsRows = f.parsed.rows.filter((r) => r.lat !== null);
    const a: LaneAnalysis = { file: f.name, lane: f.lane, gpsRows: gpsRows.length, s0Auto: null, s0: null, s0Source: null, slope: null, iqr: null, lateral: null, lateralResidual: null };
    if (gpsRows.length >= MIN_GPS_ROWS) {
      const proj = gpsRows.map((r) => ({ ...axis(r.lon as number, r.lat as number), d: r.d }));
      const v = proj.map((q) => q.station + q.d);
      a.s0Auto = round(median(v), 1);
      a.iqr = round(quantile(v, 0.75) - quantile(v, 0.25), 1);
      a.lateral = median(proj.map((q) => q.offset));
      // kemiringan regresi (stasiun + DISTANCE) terhadap DISTANCE: ~0 kalau DISTANCE cocok dengan GPS
      const mx = mean(proj.map((q) => q.d)) as number, my = mean(v) as number;
      let sxy = 0, sxx = 0;
      proj.forEach((q, i) => { sxy += (q.d - mx) * (v[i] - my); sxx += (q.d - mx) ** 2; });
      a.slope = sxx > 0 ? sxy / sxx : 0;
      if (Math.abs(a.slope) >= GPS_SLOPE_MAX) errors.push({ code: "gps-slope", message: "Jarak (DISTANCE) tidak cocok dengan GPS.", file: f.name });
    }
    return a;
  });

  // s0: manual > GPS > median lajur ber-GPS
  const gpsS0 = lanes.filter((l) => l.s0Auto !== null && opts.s0?.[l.lane] === undefined).map((l) => l.s0Auto as number);
  const fallbackS0 = gpsS0.length ? round(median(gpsS0), 1) : round(median(lanes.filter((l) => l.s0Auto !== null).map((l) => l.s0Auto as number)), 1);
  for (const l of lanes) {
    const manual = opts.s0?.[l.lane];
    if (manual !== undefined && Number.isFinite(manual)) { l.s0 = manual; l.s0Source = "diisi manual"; }
    else if (l.s0Auto !== null) { l.s0 = l.s0Auto; l.s0Source = "median proyeksi GPS"; }
    else if (fallbackS0 !== null) { l.s0 = fallbackS0; l.s0Source = "median s0 lajur lain (tanpa GPS)"; }
    else errors.push({ code: "no-gps-runway", message: "Tidak ada lajur ber-GPS; posisi tidak bisa ditentukan.", file: l.file });
  }
  out.lanes = lanes;
  const sources = new Set(lanes.map((l) => (l.s0Source === "diisi manual" ? "manual" : "gps")));
  out.s0Mode = sources.size === 0 ? null : sources.size > 1 ? "mixed" : sources.has("manual") ? "manual" : "gps";

  // sisa lateral GPS terhadap pola lajur lain (info; peringatan > 1,5 m)
  const withGps = lanes.filter((l) => l.lateral !== null);
  if (withGps.length >= 2) {
    const shift = median(withGps.map((l) => (l.lateral as number) - laneOffset(l.lane))) as number;
    for (const l of withGps) {
      l.lateralResidual = round((l.lateral as number) - laneOffset(l.lane) - shift, 2);
      if (Math.abs(l.lateralResidual as number) > LATERAL_MAX_M)
        warnings.push({ code: "lateral", message: `${l.lane}: posisi lateral GPS ${l.lateralResidual} m dari pola lajur lain; periksa label lajur.`, file: l.file });
    }
  }
  if (errors.length) return out;

  // peringatan tingkat runway
  if (ok.length < 8) {
    const have = LANE_ORDER.filter((c) => byLane.has(c));
    warnings.push({ code: "partial-lanes", message: `RWY ${runway}: hanya ${ok.length} dari 8 lajur (${have.join(", ")}). Nilai penentu (governing) hanya dari lajur terukur.` });
  }
  if (new Set(ok.map((f) => f.parsed.rows.length)).size > 1)
    warnings.push({ code: "lane-length", message: `RWY ${runway}: jumlah baris antarlajur berbeda (${ok.map((f) => `${f.lane} ${f.parsed.rows.length}`).join(", ")}).` });
  const starts = ok.map((f) => Date.parse(f.parsed.startUtc));
  if ((Math.max(...starts) - Math.min(...starts)) / 3600_000 > SPAN_MAX_H)
    warnings.push({ code: "span", message: `RWY ${runway}: waktu mulai lajur pertama dan terakhir berselisih lebih dari ${SPAN_MAX_H} jam.` });

  // ---- hitung unit
  const ST = stations.runways[runway];
  const S = stationIdx(ST);
  if (seed.units.length !== S.n) {
    errors.push({ code: "config", message: `Tabel stasiun (${S.n} unit) tidak cocok dengan berkas seed (${seed.units.length} unit).` });
    return out;
  }
  const N = S.n;
  const r4 = (x: number | null) => round(x, 4);
  const placed = new Map<LaneCode, ReturnType<typeof placeLane>>();
  for (const l of lanes) placed.set(l.lane, placeLane(ok.find((f) => f.name === l.file)!.parsed.rows.map((r) => r.mu), l.s0 as number, S));

  const buildUnits = (src: Map<LaneCode, ReturnType<typeof placeLane>>): SkidUnit[] =>
    seed.units.map((su, u) => {
      const k = N - 1 - u;
      const laneVals = LANE_ORDER.map((code) => {
        const pl = src.get(code);
        return {
          lane: code, offset_m: laneOffset(code),
          mu_10m: pl ? r4(pl.mu10[k]) : null,
          n: pl ? pl.n[k] : 0,
          mu_152m: pl ? r4(pl.mu152[k]) : null,
        };
      });
      const gov = (key: "mu_10m" | "mu_152m") => {
        let best: { lane: LaneCode; mu: number } | null = null;
        for (const lv of laneVals) {
          const v = lv[key];
          if (v !== null && (best === null || v < best.mu)) best = { lane: lv.lane, mu: v };
        }
        return best;
      };
      return {
        unit: su.unit, station_start_m: su.station_start_m, station_mid_m: su.station_mid_m,
        lanes: laneVals, lanes_measured: laneVals.filter((lv) => lv.n > 0).length,
        governing_10m: gov("mu_10m"), governing_152m: gov("mu_152m"),
        centroid_lonlat: su.centroid_lonlat,
      };
    });
  const units = buildUnits(placed);

  // ---- tingkat survei
  const startUtcMs = Math.min(...starts);
  const endMs = Math.max(...ok.map((f) => Date.parse(endUtcOf(f.parsed))));
  const measuredLen = Math.max(...ok.map((f) => f.parsed.rows.length));
  const covered = units.filter((u) => u.lanes_measured > 0).map((u) => u.unit);
  const survey = {
    device: "Moventor Skiddometer", speed_kmh: SKID_SPEED.target, wetting: ok[0].parsed.wetting ?? "On",
    direction: (runway === "06-24" ? "06" : "07L") as "06" | "07L",
    start_utc: isoUtc(startUtcMs), end_utc: isoUtc(endMs), start_wib: toWib(isoUtc(startUtcMs)), end_wib: toWib(isoUtc(endMs)),
    measured_length_m: measuredLen,
  };

  const laneMeta: SkidLaneMeta[] = LANE_ORDER.map((code) => {
    const l = lanes.find((x) => x.lane === code);
    const f = ok.find((x) => x.lane === code);
    if (!l || !f) return { code, side: laneSide(code), offset_m: laneOffset(code), gps: false, s0_m: null, s0_source: "", record_start_utc: null, mean_mu_run: null, mean_speed_kmh: null, file: "", measured: false };
    const st = f.stats as FileStats;
    return {
      code, side: laneSide(code), offset_m: laneOffset(code), gps: l.gpsRows >= MIN_GPS_ROWS,
      s0_m: l.s0, s0_source: l.s0Source as string, record_start_utc: f.parsed.startUtc,
      mean_mu_run: r4(st.meanMu), mean_speed_kmh: round(st.meanSpeed, 2), file: f.name, measured: true,
    };
  });

  const importedAt = opts.importedAt ?? new Date().toISOString();
  const unitsFileName = opts.unitsFileName ?? `skid-${runway}-2026.json`;
  const unitsOut: SkidRunwayData = {
    schema_version: 1, runway, unit_numbering: seed.unit_numbering, survey,
    coverage: { first_unit: Math.min(...covered, Infinity), last_unit: Math.max(...covered, -Infinity), n_units: covered.length, n_units_total: N },
    thresholds: seed.thresholds, basis: seed.basis, offset_sign: seed.offset_sign,
    position_uncertainty_units: seed.position_uncertainty_units, geometry_source: seed.geometry_source,
    lanes: laneMeta, units,
    source: { kind: "admin-import", imported_at: importedAt, ...(opts.appVersion ? { app_version: opts.appVersion } : {}) },
  };
  if (covered.length === 0) {
    errors.push({ code: "no-coverage", message: `RWY ${runway}: tidak ada bacaan yang jatuh di dalam unit (periksa s0).` });
    return out;
  }

  // ---- berkas per meter
  const traceLanes: SkidLaneTrace[] = LANE_ORDER.map((code) => {
    const l = lanes.find((x) => x.lane === code);
    const f = ok.find((x) => x.lane === code);
    if (!l || !f) {
      return {
        lane: code, offset_m: laneOffset(code), file: "", s0_m: null, gps: false, record_start_utc: null, measured: false,
        d_first: 1, length_m: 0, time_first: null, time_last: null, mu: [], speed_kmh: [], markers: [],
        stats: { rows: 0, mu_null: 0, speed_null: 0, held_rows: 0, gps_rows: 0, mean_mu: null, mean_speed_kmh: null, min_speed_kmh: null, max_speed_kmh: null, rows_outside_speed_tol: 0 },
        header: { length: null, runway_direction: null, wetting: null, friction: null, speed_kmh: null },
      };
    }
    const R = f.parsed.rows, st = f.stats as FileStats;
    const markers: { d: number; text: string }[] = [];
    R.forEach((r) => { if (r.marker.trim() !== "") markers.push({ d: r.d, text: r.marker.trim() }); });
    return {
      lane: code, offset_m: laneOffset(code), file: f.name, s0_m: l.s0, gps: l.gpsRows >= MIN_GPS_ROWS,
      record_start_utc: f.parsed.startUtc, measured: true, d_first: 1, length_m: R.length,
      time_first: R[0].time || null, time_last: R[R.length - 1].time || null,
      mu: R.map((r) => r.mu), speed_kmh: R.map((r) => r.speed), markers,
      stats: {
        rows: R.length, mu_null: st.muNull, speed_null: st.speedNull, held_rows: st.heldRows, gps_rows: st.gpsRows,
        mean_mu: r4(st.meanMu), mean_speed_kmh: round(st.meanSpeed, 2), min_speed_kmh: st.minSpeed, max_speed_kmh: st.maxSpeed,
        rows_outside_speed_tol: st.outsideSpeed,
      },
      header: {
        length: metaValue(f.parsed.meta, "LENGTH"), runway_direction: f.parsed.runwayDirection, wetting: f.parsed.wetting,
        friction: metaValue(f.parsed.meta, "FRICTION", "STATISTICS"), speed_kmh: metaValue(f.parsed.meta, "SPEED (km/h)", "STATISTICS"),
      },
    };
  });

  // ---- rekonsiliasi: hitung ulang dari berkas per meter, bandingkan dengan berkas per unit
  const again = new Map<LaneCode, ReturnType<typeof placeLane>>();
  for (const t of traceLanes) if (t.measured !== false) again.set(t.lane, placeLane(t.mu, t.s0_m as number, S));
  const unitsAgain = buildUnits(again);
  const rec = { unit_lane_pairs: 0, n_ok: 0, mu_10m_ok: 0, mu_152m_ok: 0, max_abs_diff_10m: 0, max_abs_diff_152m: 0, edge_cases: [] as string[] };
  const diff = (a: number | null, b: number | null) => (a === null || b === null ? (a === b ? 0 : Infinity) : Math.abs(a - b));
  units.forEach((u, i) => u.lanes.forEach((lv, j) => {
    const w = unitsAgain[i].lanes[j];
    rec.unit_lane_pairs++;
    if (lv.n === w.n) rec.n_ok++;
    const d10 = diff(lv.mu_10m, w.mu_10m), d152 = diff(lv.mu_152m, w.mu_152m);
    if (d10 <= 0.00005 + 1e-9) rec.mu_10m_ok++;
    if (d152 <= 0.00005 + 1e-9) rec.mu_152m_ok++;
    if (Number.isFinite(d10)) rec.max_abs_diff_10m = Math.max(rec.max_abs_diff_10m, d10);
    if (Number.isFinite(d152)) rec.max_abs_diff_152m = Math.max(rec.max_abs_diff_152m, d152);
  }));
  if (rec.n_ok !== rec.unit_lane_pairs || rec.mu_10m_ok !== rec.unit_lane_pairs || rec.mu_152m_ok !== rec.unit_lane_pairs) {
    errors.push({ code: "reconcile", message: "Rekonsiliasi berkas per unit dan per meter gagal (bug, bukan masalah data)." });
    return out;
  }
  rec.max_abs_diff_10m = round(rec.max_abs_diff_10m, 6) as number;
  rec.max_abs_diff_152m = round(rec.max_abs_diff_152m, 6) as number;

  const trace: SkidRunwayTrace = {
    schema_version: 1, kind: "skid-1m", runway,
    generated_by: "src/lib/skid-import.ts (admin)", generated_at: importedAt,
    source_units_file: unitsFileName, survey,
    station_rule: "station_m = s0_m - DISTANCE; DISTANCE = d_first + index",
    x_rule: "x_m (distance from the first runway end in the test direction) = unit_bounds.last_end_m - station_m",
    unit_bounds: { starts_m: ST.starts_m, last_end_m: ST.last_end_m, window_mid_m: ST.window_mid_m },
    speed_tolerance_kmh: { target: SKID_SPEED.target, tol: SKID_SPEED.tol, ref: "FAA AC 150/5320-12C App. 3 par. 1.a(7)" },
    reconciliation: rec, lanes: traceLanes,
  };
  out.units = unitsOut;
  out.trace = trace;
  return out;
}

// ---------------------------------------------------------------- beberapa runway sekaligus

export interface ImportInput { name: string; text: string; runway?: RunwayId | null; lane?: LaneCode | null }

export interface SurveyBuild {
  files: InspectedFile[];
  runways: Partial<Record<RunwayId, RunwayBuild>>;
  /** Semua galat (per berkas + per runway); Proses hanya boleh jalan kalau kosong. */
  errors: Issue[];
}

/** Pemeriksaan per berkas, dikelompokkan per runway, lalu satu build per runway. */
export function buildSurvey(
  inputs: ImportInput[],
  seeds: Record<RunwayId, SkidRunwayData>,
  stations: StationTable,
  opts: { s0?: Partial<Record<RunwayId, Partial<Record<LaneCode, number>>>> } & Omit<BuildOptions, "s0"> = {},
): SurveyBuild {
  const files = inputs.map((i) => inspectFile(i.name, i.text, { runway: i.runway, lane: i.lane }));
  const out: SurveyBuild = { files, runways: {}, errors: files.flatMap((f) => f.errors) };
  for (const rw of ["06-24", "07L-25R"] as const) {
    const mine = files.filter((f) => f.runway === rw && f.errors.length === 0);
    if (mine.length === 0) continue;
    const b = buildRunway(mine, rw, seeds[rw], stations, { ...opts, s0: opts.s0?.[rw] });
    out.runways[rw] = b;
    out.errors.push(...b.errors);
  }
  return out;
}
