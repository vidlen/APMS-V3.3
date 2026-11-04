// src/lib/texture-import.ts — keluaran paket TEKSTUR_2026 (olah_tekstur.m) menjadi satu JSON per runway untuk tab
// Macrotexture. Dipakai bersama oleh scripts/texture/build-texture.mjs dan panel admin, jadi tanpa React, tanpa `ol`,
// dan tanpa `fs`. Statistik dihitung dari berkas bands; cek_per_unit hanya pemeriksa (V11), nilainya tidak disalin.
import {
  ETD_A,
  ETD_B,
  TEXTURE_CLASSES,
  TEXTURE_HIGH_MPD_MM,
  TEXTURE_KEEL_HALF_WIDTH_M,
  TEXTURE_K_MINIMUM_MM,
  TEXTURE_K_PLANNING_MM,
  TEXTURE_LEVELS_MM,
  etdFromMpd,
  faaLevel,
} from "../config/texture.ts";
import type { TextureFileRole, TextureHighValue, TexturePass, TextureRunwayData, TextureUnit, TextureZone, TextureZoneId } from "../types/texture.ts";
import type { RunwayId } from "../types/skid.ts";
import { summarizeTexture, unitRanges } from "./texture.ts";

export interface Issue {
  level: "error" | "warn";
  /** Nomor cek brief §5.3 ("V3"), atau "format" untuk masalah pembacaan berkas. */
  check?: string;
  file?: string;
  message: string;
}
export interface TextureInputFile {
  name: string;
  text: string;
}
export interface TextureBuildOptions {
  runway: RunwayId;
  nUnits: number; // 300 untuk 06-24, 360 untuk 07L-25R
  survey: Omit<TextureRunwayData["survey"], "lcms_survey_id"> & { lcms_survey_id?: string | null };
  sourceKind: "seed" | "admin-import";
  requireComplete: boolean; // true di seed dan admin; false hanya di uji fixture
  checkUnits?: number[]; // hanya dipakai bila requireComplete=false: unit yang dicek V11
  sha256?: Record<string, string>; // nama berkas -> hash (dihitung pemanggil)
}
export interface TextureBuild {
  data: TextureRunwayData | null; // null kalau ada error
  issues: Issue[];
  roles: Record<string, TextureFileRole | "unknown" | "raw-lcms">;
  report: string[];
}

const REQUIRED_ROLES: TextureFileRole[] = ["bands", "units-check", "passes"];
const ROLE_ORDER: TextureFileRole[] = [...REQUIRED_ROLES, "photo-check"];
const STATUSES: readonly string[] = ["valid", "dropout", "luar", "belok"];
const MAX_ISSUES_PER_CHECK = 20;
const TOL_V11_MM = 0.0006;
const TOL_SUM_M = 0.02;
const KEEL_LIMIT_HIGH = 6.005; // |offset| terbulatkan 2 desimal, jadi 6,00 bisa di dalam atau di luar keel
const KEEL_LIMIT_LOW = 5.995;
const LANE_COUNT = 120;
const LANE_WIDTH_M = 0.5;
const LANE_MIN_M = -30;

const ENDS: Record<RunwayId, { e1: string; e2: string; folder: string; label: string }> = {
  "06-24": { e1: "06", e2: "24", folder: "0624", label: "RWY 06/24" },
  "07L-25R": { e1: "07L", e2: "25R", folder: "07L25R", label: "RWY 07L/25R" },
};

const columnsOf = (e1: string, e2: string): Record<TextureFileRole, string[]> => ({
  bands: `segmen_id;lintasan;band;unit;zona_faa;jarak_dari_${e1}_m;stasiun_dari_${e2}_m;offset_m;mpd_mm;keel;cek_foto;lat;lon;arah;status;gambar`.split(";"),
  "units-check": `unit;zona_faa;jarak_tengah_dari_${e1}_m;n_keel;mpd_keel_rata_mm;mpd_keel_sd_mm;n_lebar_penuh;mpd_lebar_penuh_rata_mm`.split(";"),
  passes: `lintasan;n_segmen;jarak_awal_dari_${e1}_m;jarak_akhir_dari_${e1}_m;pusat_pindaian_offset_m;mpd_rata_mm;arah;waktu_mulai`.split(";"),
  "photo-check": `segmen_id;band;unit;jarak_dari_${e1}_m;offset_m;mpd_mm;keel;gambar`.split(";"),
});

// Butir §11 yang masih menunggu surveyor.
const CAVEATS = [
  "Grooving is unknown. AC 150/5320-12C par. 3-24 does not allow groove depth to be measured. If the runway is grooved and the LCMS did not remove the grooves, MPD reads too high.",
  "The LCMS MPD algorithm (E1845 or ISO 13473-1), the sample interval and the calibration are not yet confirmed. The order of the band polygons is assumed to match MPDBand1–MPDBand5.",
];

const BOM = String.fromCharCode(0xfeff);
const stripBom = (s: string): string => (s.startsWith(BOM) ? s.slice(1) : s);
const firstLine = (s: string): string => s.slice(0, s.search(/\r?\n|$/));
const round = (v: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};
const r6 = (v: number): number => round(v, 6);
const mean = (v: readonly number[]): number => v.reduce((s, x) => s + x, 0) / v.length;
/** Simpangan baku sampel (pembagi n − 1), sama dengan `std` MATLAB. */
function sampleSd(v: readonly number[]): number {
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}
function median(v: readonly number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Medan survei yang sama untuk semua survei dari paket ini. */
export function textureSurvey(s: { id: string; label: string; date: string; lcms?: string | null }): TextureBuildOptions["survey"] {
  return {
    id: s.id,
    label: s.label,
    date: s.date,
    lcms_survey_id: s.lcms || null,
    device: "LCMS 3D laser, MPD per 10 m segment in 5 transverse bands",
    package: "TEKSTUR_2026 (olah_tekstur.m)",
  };
}

export function detectRole(headerLine: string): TextureFileRole | "unknown" | "raw-lcms" {
  const head = stripBom(headerLine).trim();
  // Sebelum pecah kolom: CSV mentah memakai koma, bukan titik koma.
  if (head.includes("MPDBand1") || head.includes("AvgGeoJSON")) return "raw-lcms";
  const cols = head.split(";");
  if (cols.includes("mpd_keel_rata_mm")) return "units-check";
  if (cols.includes("pusat_pindaian_offset_m")) return "passes";
  if (cols.includes("status") && cols.includes("keel") && cols.includes("lintasan")) return "bands";
  if (cols.includes("gambar") && cols.includes("mpd_mm") && !cols.includes("status")) return "photo-check";
  return "unknown";
}

/** Kolom berakhiran _dari_06_m -> 06-24, _dari_07L_m -> 07L-25R. Kolom stasiun_dari_24/25R diabaikan. */
export function detectRunway(headerLine: string): RunwayId | null {
  const m = /(?:^|;)jarak(?:_tengah|_awal)?_dari_(06|07L)_m(?:;|$)/.exec(stripBom(headerLine).trim());
  return m ? (m[1] === "06" ? "06-24" : "07L-25R") : null;
}

/** "1,034" -> 1.034, "" -> null. Selain itu dilempar sebagai error (titik desimal pun bukan format paket ini). */
export function parseDecimal(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  if (!/^[+-]?\d+(,\d+)?$/.test(t)) throw new Error(`"${s}" is not a decimal number`);
  return Number(t.replace(",", "."));
}

interface Row {
  line: number; // nomor baris berkas, baris 1 = kepala
  cells: string[];
}
interface Table {
  name: string;
  header: string[];
  rows: Row[];
}

function parseTable(name: string, text: string): Table {
  const lines = stripBom(text).split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return {
    name,
    header: (lines[0] ?? "").split(";").map((h) => h.trim()),
    rows: lines.slice(1).map((l, i) => ({ line: i + 2, cells: l.split(";") })),
  };
}

interface BandRow {
  line: number;
  seg: number;
  pass: number;
  band: number;
  unit: number;
  zone: number;
  x: number;
  offset: number;
  mpd: number;
  keel: number;
  photo: number;
  dir: string;
  status: string;
  image: string;
}

export function buildTexture(files: TextureInputFile[], opt: TextureBuildOptions): TextureBuild {
  const issues: Issue[] = [];
  const counts = new Map<string, { level: Issue["level"]; n: number }>();
  const add = (level: Issue["level"], check: string, text: string, file?: string, line?: number) => {
    const c = counts.get(check) ?? { level, n: 0 };
    c.n++;
    counts.set(check, c);
    if (c.n > MAX_ISSUES_PER_CHECK) return;
    const where = file ? `${file}${line ? `, line ${line}` : ""}: ` : "";
    issues.push({ level, check, file, message: `${where}${text}` });
  };
  const addPlain = (level: Issue["level"], check: string, message: string, file?: string) => {
    issues.push({ level, check, file, message });
  };
  const roles: TextureBuild["roles"] = {};
  const report: string[] = [];
  const failed = () => issues.some((i) => i.level === "error");
  const finish = (data: TextureRunwayData | null): TextureBuild => {
    for (const [check, c] of counts) {
      if (c.n > MAX_ISSUES_PER_CHECK) issues.push({ level: c.level, check, message: `${check}: ${c.n - MAX_ISSUES_PER_CHECK} more not shown.` });
    }
    return { data: failed() ? null : data, issues, roles, report };
  };

  const { e1, e2, folder, label: runwayLabel } = ENDS[opt.runway];
  const N = opt.nUnits;

  // ---- berkas dan perannya
  const tables: Partial<Record<TextureFileRole, Table>> = {};
  for (const f of files) {
    const text = stripBom(f.text);
    const head = firstLine(text);
    const role = detectRole(head);
    roles[f.name] = role;
    if (role === "raw-lcms") {
      addPlain("error", "format", `${f.name} is the raw LCMS texture export. Run olah_tekstur.m in the TEKSTUR_2026 package and upload the files from hasil\\${folder}\\.`, f.name);
    } else if (!head.includes(";")) {
      addPlain("error", "format", `${f.name}: expected ';' as column separator (Indonesian-locale CSV from the TEKSTUR_2026 package).`, f.name);
    } else if (role === "unknown") {
      addPlain("error", "format", `${f.name}: columns not recognised as a file of the TEKSTUR_2026 package.`, f.name);
    } else if (tables[role]) {
      addPlain("error", "format", `${f.name} and ${tables[role]?.name} are both the ${role} file. Upload one of each.`, f.name);
    } else {
      tables[role] = parseTable(f.name, text);
    }
  }
  for (const role of REQUIRED_ROLES) {
    if (!tables[role] && !failed()) addPlain("error", "format", `The ${role} file is missing.`);
  }
  if (failed()) return finish(null);

  // ---- V1, V2: kolom dan runway
  const columns = columnsOf(e1, e2);
  for (const role of ROLE_ORDER) {
    const t = tables[role];
    if (!t) continue;
    const rw = detectRunway(t.header.join(";"));
    if (rw && rw !== opt.runway) {
      addPlain("error", "V2", `${t.name} is for ${ENDS[rw].label}, but ${runwayLabel} is selected.`, t.name);
      continue;
    }
    const missing = columns[role].filter((c) => !t.header.includes(c));
    if (missing.length > 0) addPlain("error", "V1", `${t.name}: missing columns ${missing.join(", ")}.`, t.name);
  }
  if (failed()) return finish(null);

  const bandsT = tables.bands as Table;
  const unitsT = tables["units-check"] as Table;
  const passesT = tables.passes as Table;
  const photoT = tables["photo-check"];

  /** Pembaca kolom satu tabel. Sel kosong atau rusak dicatat sebagai error "format". */
  const reader = (t: Table) => {
    const at = new Map(t.header.map((h, i) => [h, i]));
    const text = (r: Row, c: string): string => r.cells[at.get(c) as number]?.trim() ?? "";
    const maybe = (r: Row, c: string): number | null => {
      try {
        return parseDecimal(text(r, c));
      } catch {
        add("error", "format", `column ${c}: "${text(r, c)}" is not a number.`, t.name, r.line);
        return null;
      }
    };
    const need = (r: Row, c: string): number => {
      const raw = text(r, c);
      const v = maybe(r, c);
      if (v === null && raw === "") add("error", "format", `column ${c} is empty.`, t.name, r.line);
      return v ?? Number.NaN;
    };
    return { text, maybe, need };
  };

  // ---- baris bands
  const rb = reader(bandsT);
  const xCol = `jarak_dari_${e1}_m`;
  const stCol = `stasiun_dari_${e2}_m`;
  const sums: number[] = [];
  const bands: BandRow[] = bandsT.rows.map((r) => {
    const x = rb.need(r, xCol);
    sums.push(x + rb.need(r, stCol));
    return {
      line: r.line,
      seg: rb.need(r, "segmen_id"),
      pass: rb.need(r, "lintasan"),
      band: rb.need(r, "band"),
      unit: rb.need(r, "unit"),
      zone: rb.need(r, "zona_faa"),
      x,
      offset: rb.need(r, "offset_m"),
      mpd: rb.need(r, "mpd_mm"),
      keel: rb.need(r, "keel"),
      photo: rb.need(r, "cek_foto"),
      dir: rb.text(r, "arah"),
      status: rb.text(r, "status"),
      image: rb.text(r, "gambar"),
    };
  });
  if (failed()) return finish(null);
  if (bands.length === 0) {
    addPlain("error", "format", `${bandsT.name} has no rows.`, bandsT.name);
    return finish(null);
  }

  // ---- zona menurut nomor unit
  const zoneRanges: [number, number][] = ([1, 2, 3] as const).map((z) => [1 + Math.floor(((z - 1) * N) / 3), Math.floor((z * N) / 3)]);
  const zoneOf = (unit: number): TextureZoneId => (unit <= zoneRanges[0][1] ? 1 : unit <= zoneRanges[1][1] ? 2 : 3);

  // ---- V3..V8: per baris
  const bn = bandsT.name;
  const segments = new Map<number, { n: number; bands: Set<number>; pass: number; dir: string; line: number }>();
  for (const b of bands) {
    if (!Number.isInteger(b.band) || b.band < 1 || b.band > 5) add("error", "V3", `band ${b.band} is not 1..5.`, bn, b.line);
    if (!STATUSES.includes(b.status)) add("error", "V3", `status "${b.status}" is not valid, dropout, luar or belok.`, bn, b.line);
    if (b.keel !== 0 && b.keel !== 1) add("error", "V3", `keel ${b.keel} is not 0 or 1.`, bn, b.line);
    if (b.photo !== 0 && b.photo !== 1) add("error", "V3", `cek_foto ${b.photo} is not 0 or 1.`, bn, b.line);
    if (!Number.isInteger(b.unit) || b.unit < 0 || b.unit > N) add("error", "V3", `unit ${b.unit} is not 0..${N}.`, bn, b.line);
    if (!Number.isInteger(b.zone) || b.zone < 0 || b.zone > 3) add("error", "V3", `zona_faa ${b.zone} is not 0..3.`, bn, b.line);
    if ((b.unit === 0) !== (b.zone === 0)) add("error", "V3", `unit ${b.unit} with zona_faa ${b.zone}: unit 0 and zone 0 must go together.`, bn, b.line);
    if (b.unit > 0 && b.zone !== zoneOf(b.unit)) add("error", "V4", `unit ${b.unit} has zona_faa ${b.zone}, expected ${zoneOf(b.unit)}.`, bn, b.line);

    const abs = Math.abs(b.offset);
    if (b.keel === 1 && (b.status !== "valid" || b.unit === 0 || abs > KEEL_LIMIT_HIGH)) add("error", "V6", `keel = 1 with status ${b.status}, unit ${b.unit}, offset ${b.offset}.`, bn, b.line);
    if (b.keel === 0 && b.status === "valid" && b.unit > 0 && abs < KEEL_LIMIT_LOW) add("error", "V6", `valid value at offset ${b.offset} has keel = 0.`, bn, b.line);

    if (b.status === "dropout" && b.mpd > 0) add("error", "V7", `status dropout with mpd_mm ${b.mpd} > 0.`, bn, b.line);
    if (b.status === "valid" && b.mpd <= 0) add("error", "V7", `status valid with mpd_mm ${b.mpd} ≤ 0.`, bn, b.line);
    if ((b.status === "belok") !== (b.dir === "belok")) add("error", "V7", `status ${b.status} with arah ${b.dir}: belok must appear in both or neither.`, bn, b.line);

    if ((b.photo === 1) !== b.mpd > TEXTURE_HIGH_MPD_MM) add("error", "V8", `cek_foto ${b.photo} with mpd_mm ${b.mpd}.`, bn, b.line);

    const s = segments.get(b.seg);
    if (!s) {
      segments.set(b.seg, { n: 1, bands: new Set([b.band]), pass: b.pass, dir: b.dir, line: b.line });
    } else {
      s.n++;
      s.bands.add(b.band);
      if (s.pass !== b.pass || s.dir !== b.dir) add("error", "V5", `segment ${b.seg}: lintasan or arah differs from line ${s.line}.`, bn, b.line);
    }
  }
  for (const [seg, s] of segments) {
    if (s.n !== 5 || s.bands.size !== 5) add("error", "V5", `segment ${seg} has ${s.n} rows, expected one for each of bands 1..5.`, bn, s.line);
  }

  // Unit dan zona dipakai sebagai indeks di bawah, jadi nilai di luar rentang berhenti di sini.
  if (issues.some((i) => i.check === "V3")) return finish(null);

  // ---- V9: jarak + stasiun tetap
  const sumMin = sums.reduce((a, b) => Math.min(a, b));
  const sumMax = sums.reduce((a, b) => Math.max(a, b));
  if (sumMax - sumMin > TOL_SUM_M + 1e-9) add("error", "V9", `${xCol} + ${stCol} varies by ${(sumMax - sumMin).toFixed(3)} m (limit ${TOL_SUM_M} m).`, bn);
  const lengthM = round(median(sums), 2);

  // ---- V10: units-check
  const ru = reader(unitsT);
  const midCol = `jarak_tengah_dari_${e1}_m`;
  const checks = new Map<number, { row: Row; x: number; nKeel: number; mpdKeel: number | null; sdKeel: number | null; nFull: number; mpdFull: number | null }>();
  for (const r of unitsT.rows) {
    const unit = ru.need(r, "unit");
    if (!Number.isInteger(unit) || unit < 1 || unit > N) {
      add("error", "V10", `unit ${unit} is not 1..${N}.`, unitsT.name, r.line);
      continue;
    }
    if (checks.has(unit)) add("error", "V10", `unit ${unit} appears more than once.`, unitsT.name, r.line);
    const z = ru.need(r, "zona_faa");
    if (z !== zoneOf(unit)) add("error", "V4", `unit ${unit} has zona_faa ${z}, expected ${zoneOf(unit)}.`, unitsT.name, r.line);
    checks.set(unit, {
      row: r,
      x: ru.need(r, midCol),
      nKeel: ru.need(r, "n_keel"),
      mpdKeel: ru.maybe(r, "mpd_keel_rata_mm"),
      sdKeel: ru.maybe(r, "mpd_keel_sd_mm"),
      nFull: ru.need(r, "n_lebar_penuh"),
      mpdFull: ru.maybe(r, "mpd_lebar_penuh_rata_mm"),
    });
  }
  if (unitsT.rows.length !== N) add("error", "V10", `has ${unitsT.rows.length} rows, expected ${N}.`, unitsT.name);
  for (let k = 1; k <= N; k++) if (!checks.has(k)) add("error", "V10", `unit ${k} is missing.`, unitsT.name);
  // Perhitungan di bawah butuh tepat satu baris per unit; error per baris lain tetap dilaporkan bersama V11..V17.
  if (issues.some((i) => i.check === "V10" || i.check === "format")) return finish(null);

  // ---- statistik dari nilai valid ber-unit > 0
  const keelBy: number[][] = Array.from({ length: N + 1 }, () => []);
  const fullBy: number[][] = Array.from({ length: N + 1 }, () => []);
  const passBy: Map<number, number>[] = Array.from({ length: N + 1 }, () => new Map());
  const highBy: TextureHighValue[][] = Array.from({ length: N + 1 }, () => []);
  const zoneKeel: number[][] = [[], [], []];
  const allKeel: number[] = [];
  const allFull: number[] = [];
  const emptyLanes = () => ({ n: new Array<number>(LANE_COUNT).fill(0), sum: new Array<number>(LANE_COUNT).fill(0) });
  const laneAcc = { all: emptyLanes(), zone1: emptyLanes(), zone2: emptyLanes(), zone3: emptyLanes() };
  let valid = 0;
  let dropout = 0;
  let outside = 0;
  let turning = 0;
  let nHigh = 0;
  let nHighKeel = 0;
  for (const b of bands) {
    if (b.status === "valid") valid++;
    else if (b.status === "dropout") dropout++;
    else if (b.status === "luar") outside++;
    else turning++;
    if (b.photo === 1) {
      nHigh++;
      if (b.keel === 1) nHighKeel++;
    }
    if (b.status !== "valid" || b.unit === 0) continue;
    fullBy[b.unit].push(b.mpd);
    allFull.push(b.mpd);
    if (b.keel === 1) {
      keelBy[b.unit].push(b.mpd);
      passBy[b.unit].set(b.pass, (passBy[b.unit].get(b.pass) ?? 0) + 1);
      zoneKeel[zoneOf(b.unit) - 1].push(b.mpd);
      allKeel.push(b.mpd);
    }
    if (b.photo === 1) {
      highBy[b.unit].push({
        segment_id: b.seg,
        pass: b.pass,
        band: b.band as TextureHighValue["band"],
        x_m: b.x,
        offset_m: b.offset,
        mpd_mm: b.mpd,
        keel: b.keel === 1,
        image: b.image,
      });
    }
    const lane = Math.min(LANE_COUNT - 1, Math.max(0, Math.floor((b.offset - LANE_MIN_M) / LANE_WIDTH_M)));
    for (const set of [laneAcc.all, laneAcc[`zone${zoneOf(b.unit)}`]]) {
      set.n[lane]++;
      set.sum[lane] += b.mpd;
    }
  }

  // ---- V11: per unit terhadap units-check
  const v11Units = opt.requireComplete ? Array.from({ length: N }, (_, i) => i + 1) : (opt.checkUnits ?? []);
  const v11Max = { keel: 0, sd: 0, full: 0 };
  for (const unit of v11Units) {
    const c = checks.get(unit);
    if (!c) continue;
    const un = unitsT.name;
    const keel = keelBy[unit];
    const full = fullBy[unit];
    if (c.nKeel !== keel.length) add("error", "V11", `unit ${unit}: n_keel ${c.nKeel}, computed ${keel.length}.`, un, c.row.line);
    if (c.nFull !== full.length) add("error", "V11", `unit ${unit}: n_lebar_penuh ${c.nFull}, computed ${full.length}.`, un, c.row.line);
    const compare = (col: string, sheet: number | null, computed: number | null, key: keyof typeof v11Max) => {
      if ((sheet === null) !== (computed === null)) {
        add("error", "V11", `unit ${unit}: ${col} is ${sheet === null ? "empty" : sheet}, computed ${computed === null ? "no value" : computed.toFixed(4)}.`, un, c.row.line);
      } else if (sheet !== null && computed !== null) {
        const d = Math.abs(sheet - computed);
        v11Max[key] = Math.max(v11Max[key], d);
        if (d > TOL_V11_MM) add("error", "V11", `unit ${unit}: ${col} ${sheet}, computed ${computed.toFixed(4)}.`, un, c.row.line);
      }
    };
    compare("mpd_keel_rata_mm", c.mpdKeel, keel.length > 0 ? mean(keel) : null, "keel");
    compare("mpd_keel_sd_mm", c.sdKeel, keel.length > 1 ? sampleSd(keel) : null, "sd");
    compare("mpd_lebar_penuh_rata_mm", c.mpdFull, full.length > 0 ? mean(full) : null, "full");
  }

  // ---- lintasan; V12
  const rp = reader(passesT);
  const passRows = passesT.rows.map((r) => {
    const dir = rp.text(r, "arah");
    if (dir !== `ke ${e1}` && dir !== `ke ${e2}`) add("error", "V12", `arah "${dir}" is not ke ${e1} or ke ${e2}.`, passesT.name, r.line);
    const p: TexturePass = {
      pass: rp.need(r, "lintasan"),
      direction: dir === `ke ${e2}` ? "E" : "W",
      n_segments: rp.need(r, "n_segmen"),
      x_start_m: rp.need(r, `jarak_awal_dari_${e1}_m`),
      x_end_m: rp.need(r, `jarak_akhir_dari_${e1}_m`),
      scan_center_offset_m: rp.need(r, "pusat_pindaian_offset_m"),
      mpd_mm: rp.need(r, "mpd_rata_mm"),
      start_time: rp.text(r, "waktu_mulai"),
    };
    return { p, dir, line: r.line };
  });
  const passes = passRows.map((x) => x.p).sort((a, b) => a.pass - b.pass);
  if (opt.requireComplete) {
    const seen = new Map<number, { n: number; dirs: Set<string> }>();
    for (const s of segments.values()) {
      const e = seen.get(s.pass) ?? { n: 0, dirs: new Set<string>() };
      if (s.dir !== "belok") {
        e.n++;
        e.dirs.add(s.dir);
      }
      seen.set(s.pass, e);
    }
    for (const { p, dir, line } of passRows) {
      const e = seen.get(p.pass);
      if (!e) {
        add("error", "V12", `lintasan ${p.pass} is not in ${bn}.`, passesT.name, line);
        continue;
      }
      if (e.n !== p.n_segments) add("error", "V12", `lintasan ${p.pass}: n_segmen ${p.n_segments}, counted ${e.n}.`, passesT.name, line);
      if ([...e.dirs].some((d) => d !== dir)) add("error", "V12", `lintasan ${p.pass}: arah ${dir} differs from ${bn} (${[...e.dirs].join(", ")}).`, passesT.name, line);
    }
    for (const pass of seen.keys()) {
      if (!passRows.some((x) => x.p.pass === pass)) add("error", "V12", `lintasan ${pass} of ${bn} is missing.`, passesT.name);
    }
  }

  // ---- V13: photo-check sama dengan baris bands ber-cek_foto = 1
  if (photoT && opt.requireComplete) {
    const rf = reader(photoT);
    const key = (seg: number, band: number, mpd: number, image: string) => `${seg}|${band}|${mpd}|${image}`;
    const inBands = new Set(bands.filter((b) => b.photo === 1).map((b) => key(b.seg, b.band, b.mpd, b.image)));
    const inPhoto = new Set<string>();
    for (const r of photoT.rows) {
      const k = key(rf.need(r, "segmen_id"), rf.need(r, "band"), rf.need(r, "mpd_mm"), rf.text(r, "gambar"));
      inPhoto.add(k);
      if (!inBands.has(k)) add("error", "V13", `this row is not a cek_foto = 1 row of ${bn}.`, photoT.name, r.line);
    }
    for (const k of inBands) if (!inPhoto.has(k)) add("error", "V13", `the row ${k.split("|").slice(0, 2).join(" band ")} of ${bn} (cek_foto = 1) is missing.`, photoT.name);
  }
  if (failed() && issues.some((i) => i.check === "format")) return finish(null);

  // ---- ID survei LCMS dari kolom gambar
  const ids = new Set<string>();
  let idlessRows = 0;
  for (const b of bands) {
    const m = /_(\d{10})_\d{6}\.jpg$/.exec(b.image);
    if (m) ids.add(m[1]);
    else idlessRows++;
  }
  const found = ids.size === 1 && idlessRows === 0 ? [...ids][0] : null;
  const given = opt.survey.lcms_survey_id || null;
  if (!found) addPlain("warn", "lcms", `The gambar column does not give one LCMS survey id (found ${ids.size}, ${idlessRows} rows without one).`, bn);
  else if (given && given !== found) addPlain("warn", "lcms", `LCMS survey id ${given} was entered, but the gambar column gives ${found}.`, bn);

  // ---- unit
  const units: TextureUnit[] = Array.from({ length: N }, (_, i) => {
    const unit = i + 1;
    const keel = keelBy[unit];
    const full = fullBy[unit];
    const keelMpd = keel.length > 0 ? mean(keel) : null;
    const fullMpd = full.length > 0 ? mean(full) : null;
    const keelEtd = keelMpd === null ? null : etdFromMpd(keelMpd);
    const x = (checks.get(unit) as { x: number }).x;
    return {
      unit,
      zone: zoneOf(unit),
      x_mid_m: x,
      station_mid_m: round(lengthM - x, 1),
      keel: {
        n: keel.length,
        mpd_mm: keelMpd === null ? null : r6(keelMpd),
        sd_mm: keel.length > 1 ? r6(sampleSd(keel)) : null,
        etd_mm: keelEtd === null ? null : r6(keelEtd),
      },
      full: { n: full.length, mpd_mm: fullMpd === null ? null : r6(fullMpd), etd_mm: fullMpd === null ? null : r6(etdFromMpd(fullMpd)) },
      // Dari ETD presisi penuh, sebelum dibulatkan.
      k_flags: { minimum: keelEtd === null ? null : keelEtd < TEXTURE_K_MINIMUM_MM, planning: keelEtd === null ? null : keelEtd < TEXTURE_K_PLANNING_MM },
      passes: [...passBy[unit]].sort((a, b) => a[0] - b[0]).map(([pass, n_keel]) => ({ pass, n_keel })),
      high_values: highBy[unit].sort((a, b) => a.x_m - b.x_m || a.band - b.band),
    };
  });

  // ---- zona
  const zoneLabels = [`${e1} end`, "Middle", `${e2} end`];
  const zones: TextureZone[] = ([1, 2, 3] as const).map((zone) => {
    const [a, b] = zoneRanges[zone - 1];
    const vals = zoneKeel[zone - 1];
    const inZone = units.slice(a - 1, b).filter((u) => u.keel.etd_mm !== null);
    if (vals.length === 0 && opt.requireComplete) addPlain("error", "zone", `Zone ${zone} (units ${a}–${b}) has no keel values, so it cannot be judged.`);
    // Hanya fixture (requireComplete=false) yang sampai ke sini tanpa nilai keel; angkanya 0 dan tidak pernah tampil.
    const mpd = vals.length > 0 ? mean(vals) : 0;
    // keelBy presisi penuh, supaya unit terendah tidak ditentukan oleh pembulatan.
    const etdOf = (u: TextureUnit) => etdFromMpd(mean(keelBy[u.unit]));
    const min = inZone.reduce<TextureUnit | null>((m, u) => (!m || etdOf(u) < etdOf(m) ? u : m), null);
    return {
      zone,
      label: zoneLabels[zone - 1],
      units: [a, b],
      n_keel: vals.length,
      mpd_mm: r6(mpd),
      etd_mm: vals.length > 0 ? r6(etdFromMpd(mpd)) : 0,
      n_units_with_keel: inZone.length,
      min_unit: min?.unit ?? 0,
      min_unit_etd_mm: min?.keel.etd_mm ?? 0,
      n_units_below_0_76: inZone.filter((u) => etdOf(u) < TEXTURE_LEVELS_MM.plan).length,
      n_units_at_or_above_1_14: inZone.filter((u) => etdOf(u) >= TEXTURE_LEVELS_MM.measure).length,
    };
  });

  // ---- V14..V17
  const noKeel = units.filter((u) => u.keel.n === 0).map((u) => u.unit);
  const dropoutPct = valid + dropout > 0 ? (100 * dropout) / (valid + dropout) : 0;
  if (dropoutPct > 20) addPlain("error", "V14", `Dropout is ${dropoutPct.toFixed(3)}% of the values on the runway, above the 20% limit of E1845 §7.1.`, bn);
  else if (dropoutPct > 5) addPlain("warn", "V14", `Dropout is ${dropoutPct.toFixed(3)}% of the values on the runway.`, bn);
  if (noKeel.length > 0.02 * N) addPlain("warn", "V15", `${noKeel.length} of ${N} units have no keel values: ${unitRanges(noKeel).join(", ")}.`);
  for (const u of units) if (u.keel.n >= 1 && u.keel.n < 10) add("warn", "V16", `Unit ${u.unit}: only ${u.keel.n} keel values.`);
  if (nHigh > 0) addPlain("warn", "V17", `${nHigh} band values above 2 mm (${nHighKeel} in the keel). Check the LCMS images listed in the unit panel.`);

  // ---- hasil
  const lanes = (set: { n: number[]; sum: number[] }) => ({ n: set.n, mpd_mm: set.n.map((n, i) => (n > 0 ? round(set.sum[i] / n, 3) : null)) });
  const keelMean = allKeel.length > 0 ? mean(allKeel) : 0;
  const fullMean = allFull.length > 0 ? mean(allFull) : 0;
  const fileRows = ROLE_ORDER.filter((role) => tables[role]).map((role) => {
    const t = tables[role] as Table;
    return { role, name: t.name, sha256: opt.sha256?.[t.name] ?? "", rows: t.rows.length };
  });
  report.push("Files");
  for (const f of fileRows) report.push(`  ${f.role}: ${f.name} · ${f.sha256 ? `${f.sha256.slice(0, 12)} · ` : ""}${f.rows} rows`);
  if (failed()) return finish(null);

  const data: TextureRunwayData = {
    schema_version: 1,
    kind: "texture-units",
    runway: opt.runway,
    survey: { ...opt.survey, lcms_survey_id: given ?? found },
    unit_numbering: `Web numbering: unit 1 at threshold ${e1}, unit ${N} at threshold ${e2}.`,
    axis: {
      length_m: lengthM,
      x_rule: `x = distance along the sample-unit centreline from the outer edge of unit 1 (threshold ${e1}).`,
      station_rule: `station = distance from the outer edge of unit ${N} (threshold ${e2}) = ${lengthM} − x; falls as the unit number rises (skid convention).`,
    },
    keel: { half_width_m: TEXTURE_KEEL_HALF_WIDTH_M, rule: `A band value is in the keel when it is valid and |offset| ≤ ${TEXTURE_KEEL_HALF_WIDTH_M} m at full MATLAB precision (keel column of the package; not recomputed from the rounded offset).` },
    etd: { a: ETD_A, b: ETD_B, ref: "ASTM E1845 eq. 1" },
    k_rule: {
      minimum_mm: TEXTURE_K_MINIMUM_MM,
      planning_mm: TEXTURE_K_PLANNING_MM,
      comparator: "<",
      note: "k_flags compare the keel ETD of the unit with these levels. Stored for the K axis of the SKG scheme; not used in the risk calculation yet.",
    },
    qc: {
      n_values: bands.length,
      valid,
      dropout,
      outside,
      turning,
      dropout_pct: round(dropoutPct, 3),
      n_segments: segments.size,
      high_threshold_mm: TEXTURE_HIGH_MPD_MM,
      n_high: nHigh,
      n_high_keel: nHighKeel,
    },
    coverage: { n_units_total: N, n_units_with_keel: N - noKeel.length, no_keel: noKeel },
    runway_keel: { n: allKeel.length, mpd_mm: r6(keelMean), etd_mm: r6(etdFromMpd(keelMean)) },
    runway_full: { n: allFull.length, mpd_mm: r6(fullMean), etd_mm: r6(etdFromMpd(fullMean)) },
    zones,
    lanes: {
      width_m: LANE_WIDTH_M,
      offset_min_m: LANE_MIN_M,
      count: LANE_COUNT,
      rule: `Valid values with unit > 0. Lane i = floor((offset_m + 30) / 0.5), limited to 0..119, covers [−30 + 0.5i, −30 + 0.5(i+1)) m; offset 30.00 falls in lane 119. Uses the offset rounded to 0.01 m, so lanes −6..+6 m can differ from the keel statistics by a few values.`,
      all: lanes(laneAcc.all),
      zone1: lanes(laneAcc.zone1),
      zone2: lanes(laneAcc.zone2),
      zone3: lanes(laneAcc.zone3),
    },
    passes,
    units,
    processing: { caveats: CAVEATS },
    source: {
      kind: opt.sourceKind,
      ...(opt.sourceKind === "admin-import" ? { imported_at: new Date().toISOString() } : {}),
      files: fileRows,
    },
  };

  report.push(...reportLines(data, opt.requireComplete ? `${v11Units.length} units` : `units ${v11Units.join(", ")}`, v11Max));
  return finish(data);
}

function reportLines(data: TextureRunwayData, v11Scope: string, v11Max: { keel: number; sd: number; full: number }): string[] {
  const s = summarizeTexture(data);
  const f4 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(4));
  const ranges = (units: number[]) => unitRanges(units).join(", ") || "none";
  const keelN = data.units.filter((u) => u.keel.n > 0).map((u) => u.keel.n);
  const fullEtd = data.units.flatMap((u) => (u.full.etd_mm === null ? [] : [u.full.etd_mm]));
  const flagCount = (k: "minimum" | "planning") => {
    const of = (v: boolean | null) => data.units.filter((u) => u.k_flags[k] === v).length;
    return `true ${of(true)}, false ${of(false)}, null ${of(null)}`;
  };
  const withHigh = data.units.filter((u) => u.high_values.length > 0);
  const top = [...withHigh].sort((a, b) => b.high_values.length - a.high_values.length || a.unit - b.unit).slice(0, 3);
  const highKeel = withHigh.filter((u) => u.high_values.some((v) => v.keel)).map((u) => u.unit);
  const { all } = data.lanes;
  const iTop = all.mpd_mm.reduce<number>((best, v, i) => (v !== null && v > (all.mpd_mm[best] ?? -1) ? i : best), 0);
  const laneText = (i: number) => `${-30 + 0.5 * i}..${-30 + 0.5 * (i + 1)} m`;
  const emptyLanes = all.n.flatMap((n, i) => (n === 0 ? [laneText(i)] : []));
  const { qc } = data;
  return [
    `Runway: ${data.runway}; axis length ${data.axis.length_m} m; LCMS survey id ${data.survey.lcms_survey_id ?? "unknown"}`,
    `Values: ${qc.n_values}; segments ${qc.n_segments}; passes ${data.passes.length}`,
    `Status: valid ${qc.valid}, dropout ${qc.dropout}, luar ${qc.outside}, belok ${qc.turning}; dropout ${qc.dropout_pct.toFixed(3)}%`,
    `Coverage: ${data.coverage.n_units_with_keel} of ${data.coverage.n_units_total} units have keel values; none in ${ranges(data.coverage.no_keel)}`,
    `Keel values per unit (min / median / max): ${Math.min(...keelN)} / ${median(keelN)} / ${Math.max(...keelN)}`,
    "Zones",
    ...data.zones.map(
      (z) =>
        `  ${z.zone} (${z.label}, units ${z.units[0]}–${z.units[1]}): n ${z.n_keel}, MPD ${f4(z.mpd_mm)}, ETD ${f4(z.etd_mm)}, FAA ${faaLevel(z.etd_mm)}; lowest unit ${z.min_unit} (${f4(z.min_unit_etd_mm)}); units < 0.76: ${z.n_units_below_0_76}; units ≥ 1.14: ${z.n_units_at_or_above_1_14}`,
    ),
    `Runway keel: n ${data.runway_keel.n}, MPD ${f4(data.runway_keel.mpd_mm)}, ETD ${f4(data.runway_keel.etd_mm)}`,
    `Runway full width: n ${data.runway_full.n}, MPD ${f4(data.runway_full.mpd_mm)}, ETD ${f4(data.runway_full.etd_mm)}`,
    `Unit keel ETD: lowest ${f4(s.lowest?.keel.etd_mm)} (unit ${s.lowest?.unit}), median ${f4(s.medianEtd)}, highest ${f4(s.highest?.keel.etd_mm)} (unit ${s.highest?.unit})`,
    `Units below 0.76 mm: ${s.belowPlanning.length} (${ranges(s.belowPlanning)})`,
    `Unit full-width ETD: min ${f4(Math.min(...fullEtd))}, max ${f4(Math.max(...fullEtd))}`,
    `Display classes: ${TEXTURE_CLASSES.map((c) => `${c} ${s.classCounts[c]}`).join(", ")}`,
    `k_flags minimum: ${flagCount("minimum")}`,
    `k_flags planning: ${flagCount("planning")}`,
    `Values above 2 mm: ${qc.n_high} (${qc.n_high_keel} in the keel), in ${withHigh.length} units${top.length > 0 ? `; most in ${top.map((u) => `unit ${u.unit} (${u.high_values.length})`).join(", ")}` : ""}`,
    `Units with keel values above 2 mm: ${highKeel.length} (${ranges(highKeel)})`,
    `Lanes (all): Σ n ${all.n.reduce((a, b) => a + b, 0)}; highest ${laneText(iTop)}, MPD ${all.mpd_mm[iTop]?.toFixed(3)}, n ${all.n[iTop]}; lane 0..0.5 m MPD ${all.mpd_mm[60]?.toFixed(3)}, n ${all.n[60]}; empty ${emptyLanes.length}${emptyLanes.length > 0 ? ` (${emptyLanes.join(", ")})` : ""}`,
    `Largest V11 differences (${v11Scope}): keel MPD ${v11Max.keel.toFixed(5)}, keel SD ${v11Max.sd.toFixed(5)}, full MPD ${v11Max.full.toFixed(5)} mm`,
  ];
}
