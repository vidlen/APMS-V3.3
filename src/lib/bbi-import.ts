// src/lib/bbi-import.ts — empat CSV keluaran paket BBI (petakan_bbi_0624.m + konversi_unit_web.mjs) menjadi dua JSON
// yang dibaca tab Roughness (BBI). Dipakai bersama oleh scripts/bbi/build-bbi.mjs dan panel admin, jadi tanpa React,
// tanpa `ol`, dan tanpa `fs`. Tidak menghitung ulang nilai apa pun: koreksi ekspor ProFAA sudah dikerjakan MATLAB.
import {
  BBI_AXIS_LENGTH_M,
  BBI_CLASSES,
  BBI_LIMIT,
  BBI_START_OF_RUN_M,
  BBI_TRIMMED_END_M,
} from "../config/bbi.ts";
import type {
  BbiFileRole,
  BbiGoverning,
  BbiLineMeta,
  BbiLineTrace,
  BbiRunwayData,
  BbiRunwayTrace,
  BbiUnit,
  BbiUnitLine,
  BbiZone,
} from "../types/bbi.ts";
import type { RunwayId } from "../types/skid.ts";
import { summarizeBbi, unitRanges } from "./bbi.ts";

export interface Issue {
  level: "error" | "warn";
  /** Nomor cek brief §5.2 ("V3"), atau "format" untuk masalah pembacaan berkas. */
  check?: string;
  file?: string;
  message: string;
}
export interface BbiInputFile {
  name: string;
  text: string;
}
export interface BbiBuildOptions {
  runway: RunwayId;
  nUnits: number; // 300 untuk 06-24, 360 untuk 07L-25R
  survey: BbiRunwayData["survey"];
  sourceKind: "seed" | "admin-import";
  requireCompleteTrace: boolean; // true di seed dan admin; false hanya di uji fixture
  sha256?: Record<string, string>; // nama berkas -> hash (dihitung pemanggil)
}
export interface BbiBuild {
  units: BbiRunwayData | null; // null kalau ada error
  trace: BbiRunwayTrace | null;
  issues: Issue[];
  roles: Record<string, BbiFileRole | "unknown">;
  report: string[]; // baris laporan untuk skrip dan pratinjau admin
}

const ROLES: BbiFileRole[] = ["units", "unit-lines", "lines", "points"];
const ZONES: readonly string[] = ["Acceptable", "Excessive", "Unacceptable"];
const COLUMNS: Record<BbiFileRole, string[]> = {
  units: "unit_web;unit_lama;stasiun_awal_m;stasiun_akhir_m;jumlah_garis;bbi_maks;zona;garis_penentu;h_cm;panjang_bump_m;straightedge_m;catatan;jarak_dari_06_awal_m;jarak_dari_06_akhir_m".split(";"),
  "unit-lines": "unit_web;unit_lama;garis;arah;offset_lintasan_m;bbi_maks;zona;h_cm;panjang_bump_m;straightedge_m;stasiun_m;x_profaa_m;pct_bbi_lebih_1;n_titik;catatan;jarak_dari_06_m".split(";"),
  lines: "unit_web;unit_lama;garis;arah;offset_lintasan_m;bbi_rata2;bbi_maks;zona;stasiun_m;h_cm;panjang_bump_m;n_excessive;n_unacceptable;jarak_dari_06_m".split(";"),
  points: "unit_web;unit_lama;garis;x_profaa_m;stasiun_m;bbi;zona;h_cm;panjang_bump_m;straightedge_m;jarak_dari_06_m".split(";"),
};
const ROLE_FILE: Record<BbiFileRole, string> = {
  units: "bbi_per_unit_web.csv",
  "unit-lines": "bbi_per_unit_garis_web.csv",
  lines: "ringkasan_garis_web.csv",
  points: "bbi_per_titik_web.csv",
};
const MAX_ISSUES_PER_CHECK = 20;
const TOL_BBI = 5e-5;
const TOL_RECONSTRUCT_M = 0.02;

const CORRECTIONS = [
  'ProFAA 3.1.0 export: "Distance (m)" is always 0; distance rebuilt from row order × 0.25 m (petakan_bbi_0624.m).',
  'ProFAA 3.1.0 export: "Bump Height(m)" is 12× the true height (inches converted as feet); height recomputed as H = BBI × acceptable limit(L) (petakan_bbi_0624.m).',
];
const CAVEATS = [
  "Line offsets are provisional: the L–R wheel-track spacing is unknown and the position of pass 1 relative to the runway centreline is unconfirmed. Offsets do not affect unit numbers, because each unit spans the full runway width.",
  "The LCMS high-pass filter cutoff is unknown; the AC does not recommend high-passed inertial profiles for BBI (AC 150/5380-9 par. 2.2g).",
  "Pass 22 of survey 2062903736 runs west but lies on the north side, unlike the other passes; it is not used until the surveyor confirms it.",
];

const BOM = String.fromCharCode(0xfeff);
const stripBom = (s: string): string => (s.startsWith(BOM) ? s.slice(1) : s);

/** Medan survei yang sama untuk semua survei dari paket ini. */
export function bbiSurvey(s: { id: string; label: string; date: string; lcms?: string | null }): BbiRunwayData["survey"] {
  return {
    id: s.id,
    label: s.label,
    date: s.date,
    lcms_survey_id: s.lcms || null,
    device: "LCMS laser profilometer (ERD L/R, 5 mm)",
    software: "ProFAA 3.1.0",
    output_spacing_m: 0.25,
  };
}

export function detectRole(headerLine: string): BbiFileRole | "unknown" | "old-numbering" {
  const cols = stripBom(headerLine).trim().split(";");
  if (cols[0] === "unit" && !cols.includes("unit_web")) return "old-numbering";
  if (cols.includes("garis_penentu")) return "units";
  if (cols.includes("pct_bbi_lebih_1")) return "unit-lines";
  if (cols.includes("n_excessive")) return "lines";
  if (cols.includes("x_profaa_m") && cols.includes("bbi")) return "points";
  return "unknown";
}

/** "1,1871" -> 1.1871, "" -> null. Selain itu dilempar sebagai error (titik desimal pun bukan format paket ini). */
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

const shortLine = (source: string): string => source.slice(-5);
const isStartOfRun = (note: string): boolean => note.startsWith("awal lintasan");

/** Satu baris unit-lines yang sudah dibaca. */
interface Pair {
  value: BbiUnitLine;
  row: number;
}
interface LinePoints {
  xp: number[];
  x06: number[];
  bbi: number[];
  unit: number[];
  zone: (BbiZone | null)[];
  row: number[];
}

export function buildBbi(files: BbiInputFile[], opt: BbiBuildOptions): BbiBuild {
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
  const roles: BbiBuild["roles"] = {};
  const report: string[] = [];
  const finish = (units: BbiRunwayData | null, trace: BbiRunwayTrace | null): BbiBuild => {
    for (const [check, c] of counts) {
      if (c.n > MAX_ISSUES_PER_CHECK) issues.push({ level: c.level, check, message: `${check}: ${c.n - MAX_ISSUES_PER_CHECK} more not shown.` });
    }
    const failed = issues.some((i) => i.level === "error");
    return { units: failed ? null : units, trace: failed ? null : trace, issues, roles, report };
  };

  // ---- berkas dan perannya
  const tables: Partial<Record<BbiFileRole, Table>> = {};
  for (const f of files) {
    const text = stripBom(f.text);
    const head = text.slice(0, text.search(/\r?\n|$/));
    roles[f.name] = "unknown";
    if (!head.includes(";")) {
      issues.push({ level: "error", check: "format", file: f.name, message: `${f.name}: expected ';' as column separator (Indonesian-locale CSV from the BBI package).` });
      continue;
    }
    const role = detectRole(head);
    if (role === "old-numbering") {
      issues.push({ level: "error", check: "format", file: f.name, message: `${f.name} uses the old unit numbering (unit 1 at threshold 24). Run node konversi_unit_web.mjs in the BBI package and upload the *_web.csv files.` });
      continue;
    }
    if (role === "unknown") {
      issues.push({ level: "error", check: "format", file: f.name, message: `${f.name}: columns not recognised as one of the BBI *_web.csv files.` });
      continue;
    }
    roles[f.name] = role;
    if (tables[role]) issues.push({ level: "error", check: "format", file: f.name, message: `More than one ${role} file: ${tables[role].name} and ${f.name}.` });
    tables[role] = parseTable(f.name, text);
  }
  if (issues.length === 0) {
    for (const r of ROLES) if (!tables[r]) add("error", "format", `Missing the ${r} file (${ROLE_FILE[r]}).`);
  }
  if (issues.length > 0) return finish(null, null);

  const { units: unitsT, "unit-lines": pairsT, lines: linesT, points: pointsT } = tables as Record<BbiFileRole, Table>;

  // V1: semua kolom ada
  for (const r of ROLES) {
    const t = tables[r] as Table;
    for (const c of COLUMNS[r]) if (!t.header.includes(c)) add("error", "V1", `missing column ${c}.`, t.name);
  }
  if (issues.length > 0) return finish(null, null);

  const reader = (t: Table) => {
    const idx = Object.fromEntries(t.header.map((h, i) => [h, i]));
    const str = (r: Row, c: string) => (r.cells[idx[c]] ?? "").trim();
    const num = (r: Row, c: string): number | null => {
      try {
        return parseDecimal(r.cells[idx[c]] ?? "");
      } catch (e) {
        add("error", "V1", `column ${c}: ${(e as Error).message}.`, t.name, r.line);
        return null;
      }
    };
    const need = (r: Row, c: string): number => {
      const v = num(r, c);
      if (v === null) add("error", "V1", `column ${c} is empty.`, t.name, r.line);
      return v ?? 0;
    };
    // V3 di setiap baris semua berkas
    const unit = (r: Row): number => {
      const web = need(r, "unit_web");
      const lama = need(r, "unit_lama");
      if (web !== opt.nUnits + 1 - lama) add("error", "V3", `unit_web ${web} is not ${opt.nUnits} + 1 − unit_lama ${lama}.`, t.name, r.line);
      return web;
    };
    // V7 dan V8
    const zone = (r: Row, bbi: number | null): BbiZone | null => {
      const z = str(r, "zona");
      if (z !== "" && !ZONES.includes(z)) add("error", "V7", `unknown zone "${z}".`, t.name, r.line);
      const known = ZONES.includes(z) ? (z as BbiZone) : null;
      if (bbi !== null && (bbi <= BBI_LIMIT ? known !== null && known !== "Acceptable" : known !== "Excessive" && known !== "Unacceptable")) {
        add("error", "V8", `BBI ${bbi} does not fit zone "${z}".`, t.name, r.line);
      }
      return known;
    };
    // V4: bentuk kode garis
    const line = (r: Row): string => {
      const g = str(r, "garis");
      if (!/^RWY\w+_P\d{2}_[LR]$/.test(g)) add("error", "V4", `bad line code "${g}".`, t.name, r.line);
      return g;
    };
    return { str, num, need, unit, zone, line };
  };

  // ---- ringkasan garis
  const rl = reader(linesT);
  const metaBySource = new Map<string, BbiLineMeta>();
  for (const r of linesT.rows) {
    const source = rl.line(r);
    const code = shortLine(source);
    const direction = rl.str(r, "arah");
    if (direction !== "E" && direction !== "W") add("error", "V14", `direction "${direction}" is not E or W.`, linesT.name, r.line);
    if (metaBySource.has(source)) add("error", "V4", `line ${source} appears twice.`, linesT.name, r.line);
    const bbiMax = rl.need(r, "bbi_maks");
    rl.zone(r, bbiMax);
    metaBySource.set(source, {
      code,
      source_name: source,
      pass: Number(code.slice(1, 3)),
      side: code.endsWith("L") ? "L" : "R",
      direction: direction === "W" ? "W" : "E",
      offset_m: rl.need(r, "offset_lintasan_m"),
      offset_status: "provisional",
      bbi_mean: rl.need(r, "bbi_rata2"),
      bbi_max: bbiMax,
      max_unit: rl.unit(r),
      max_x_from_06_m: rl.need(r, "jarak_dari_06_m"),
      n_excessive: rl.need(r, "n_excessive"),
      n_unacceptable: rl.need(r, "n_unacceptable"),
      x_first_from_06_m: 0, // diisi dari berkas titik
      x_last_from_06_m: 0,
    });
  }
  const meta = [...metaBySource.values()].sort((a, b) => a.pass - b.pass || a.side.localeCompare(b.side));

  // ---- unit per garis
  const rp = reader(pairsT);
  const pairsByUnit = new Map<number, Map<string, Pair>>();
  const pairLines = new Set<string>();
  for (const r of pairsT.rows) {
    const unit = rp.unit(r);
    const source = rp.line(r);
    pairLines.add(source);
    const bbi = rp.need(r, "bbi_maks");
    const forUnit = pairsByUnit.get(unit) ?? new Map<string, Pair>();
    pairsByUnit.set(unit, forUnit);
    if (forUnit.has(source)) add("error", "V5", `unit ${unit} has line ${source} twice.`, pairsT.name, r.line);
    forUnit.set(source, {
      row: r.line,
      value: {
        line: shortLine(source),
        bbi_max: bbi,
        zone: rp.zone(r, bbi),
        h_cm: rp.num(r, "h_cm"),
        bump_length_m: rp.num(r, "panjang_bump_m"),
        straightedge_m: rp.num(r, "straightedge_m"),
        x_from_06_m: rp.num(r, "jarak_dari_06_m"),
        x_profaa_m: rp.num(r, "x_profaa_m"),
        pct_over_1: rp.num(r, "pct_bbi_lebih_1"),
        n_points: rp.need(r, "n_titik"),
        start_of_run: isStartOfRun(rp.str(r, "catatan")),
      },
    });
  }

  // ---- titik
  const rt = reader(pointsT);
  const points = new Map<string, LinePoints>();
  for (const r of pointsT.rows) {
    const source = rt.line(r);
    let p = points.get(source);
    if (!p) points.set(source, (p = { xp: [], x06: [], bbi: [], unit: [], zone: [], row: [] }));
    const xp = rt.need(r, "x_profaa_m");
    // V9: titik satu garis berurutan tanpa celah
    const prev = p.xp[p.xp.length - 1];
    if (prev !== undefined && Math.abs(xp - prev - 0.25) > 0.001) {
      add("error", "V9", `${shortLine(source)}: x_profaa_m jumps from ${prev} to ${xp}, expected a 0.25 m step.`, pointsT.name, r.line);
    }
    const bbi = rt.need(r, "bbi");
    p.xp.push(xp);
    p.x06.push(rt.need(r, "jarak_dari_06_m"));
    p.bbi.push(bbi);
    p.unit.push(rt.unit(r));
    p.zone.push(rt.zone(r, bbi));
    p.row.push(r.line);
  }

  // V4: himpunan garis sama di ketiga berkas
  const names = (s: Iterable<string>) => [...s].sort().join(", ");
  if (names(pairLines) !== names(metaBySource.keys())) add("error", "V4", `lines differ: ${names(metaBySource.keys())} in ${linesT.name}; ${names(pairLines)} in ${pairsT.name}.`);
  if (names(points.keys()) !== names(metaBySource.keys())) add("error", "V4", `lines differ: ${names(metaBySource.keys())} in ${linesT.name}; ${names(points.keys())} in ${pointsT.name}.`);

  // ---- per garis: rekonstruksi x, run unit, rekonsiliasi
  let maxReconstruct = 0;
  let maxDiffV6 = 0;
  let maxDiffV12 = 0;
  let maxDiffV13 = 0;
  const traces: BbiLineTrace[] = [];
  const zoneCounts = { Acceptable: 0, Excessive: 0, Unacceptable: 0, empty: 0 };
  const flaggedNotes: string[] = [];
  let nPoints = 0;
  const pairsWithRun = new Set<Pair>();
  for (const m of meta) {
    const p = points.get(m.source_name);
    if (!p) continue;
    const n = p.bbi.length;
    nPoints += n;
    const x0 = p.x06[0];
    const dx = n > 1 ? Math.round(((p.x06[n - 1] - x0) / (n - 1)) * 1e9) / 1e9 : 0;
    m.x_first_from_06_m = x0;
    m.x_last_from_06_m = p.x06[n - 1];

    // V14
    if (m.direction === "E" ? dx <= 0 : dx >= 0) add("error", "V14", `${m.code}: direction ${m.direction} but dx = ${dx}.`, pointsT.name);
    // V10
    let worst = 0;
    let worstI = 0;
    for (let i = 0; i < n; i++) {
      const e = Math.abs(x0 + i * dx - p.x06[i]);
      if (e > worst) [worst, worstI] = [e, i];
    }
    maxReconstruct = Math.max(maxReconstruct, worst);
    if (worst > TOL_RECONSTRUCT_M) add("error", "V10", `${m.code}: x0 + i·dx misses jarak_dari_06_m by ${worst.toFixed(3)} m.`, pointsT.name, p.row[worstI]);

    // V11: satu run kontigu per unit
    const runs: [number, number, number][] = [];
    const seen = new Set<number>();
    for (let i = 0; i < n; i++) {
      const u = p.unit[i];
      if (runs.length > 0 && runs[runs.length - 1][0] === u) {
        runs[runs.length - 1][2] = i;
        continue;
      }
      if (seen.has(u)) add("error", "V11", `${m.code}: unit ${u} appears in more than one run.`, pointsT.name, p.row[i]);
      seen.add(u);
      runs.push([u, i, i]);
    }

    // V12, V15 per pasangan yang punya titik
    for (const [u, a, b] of runs) {
      const pair = pairsByUnit.get(u)?.get(m.source_name);
      if (!pair) {
        add("error", "V12", `${m.code}: unit ${u} has points but no row in ${pairsT.name}.`, pointsT.name, p.row[a]);
        continue;
      }
      pairsWithRun.add(pair);
      const { bbi_max: pairMax, n_points: pairN, pct_over_1: pairPct } = pair.value;
      const seg = p.bbi.slice(a, b + 1);
      const diff = Math.abs((pairMax as number) - Math.max(...seg));
      maxDiffV12 = Math.max(maxDiffV12, diff);
      if (diff > TOL_BBI) add("error", "V12", `unit ${u} ${m.code}: bbi_maks ${pairMax} differs from the point maximum ${Math.max(...seg)}.`, pairsT.name, pair.row);
      if (pairN !== seg.length) add("error", "V12", `unit ${u} ${m.code}: n_titik ${pairN} differs from ${seg.length} points.`, pairsT.name, pair.row);
      const pct = (100 * seg.filter((v) => v > BBI_LIMIT).length) / seg.length;
      if (Math.abs((pairPct ?? 0) - pct) > 0.05) add("warn", "V15", `unit ${u} ${m.code}: pct_bbi_lebih_1 ${pairPct} differs from ${pct.toFixed(1)}.`, pairsT.name, pair.row);
    }

    // V13
    const excessive = p.zone.filter((z) => z === "Excessive").length;
    const unacceptable = p.zone.filter((z) => z === "Unacceptable").length;
    if (opt.requireCompleteTrace) {
      const max = p.bbi.reduce((a, b) => Math.max(a, b), -Infinity);
      const diff = Math.abs(m.bbi_max - max);
      maxDiffV13 = Math.max(maxDiffV13, diff);
      if (diff > TOL_BBI) add("error", "V13", `${m.code}: bbi_maks ${m.bbi_max} differs from the point maximum ${max}.`, linesT.name);
      if (m.n_excessive !== excessive) add("error", "V13", `${m.code}: n_excessive ${m.n_excessive} differs from ${excessive} points.`, linesT.name);
      if (m.n_unacceptable !== unacceptable) add("error", "V13", `${m.code}: n_unacceptable ${m.n_unacceptable} differs from ${unacceptable} points.`, linesT.name);
    }

    const flagged: BbiLineTrace["flagged"] = [];
    const nullZone: number[] = [];
    let startLast = -1;
    for (let i = 0; i < n; i++) {
      const z = p.zone[i];
      if (z === "Excessive" || z === "Unacceptable") flagged.push({ i, zone: z });
      if (z === null) nullZone.push(i);
      if (p.xp[i] < BBI_START_OF_RUN_M) startLast = i;
      zoneCounts[z ?? "empty"]++;
    }
    if (flagged.length > 0) {
      const xs = flagged.map((f) => p.x06[f.i]);
      const us = [...new Set(flagged.map((f) => p.unit[f.i]))];
      flaggedNotes.push(`${m.code} ${flagged.length} (unit ${us.join(", ")}, ${Math.min(...xs)}–${Math.max(...xs)} m from threshold)`);
    }
    traces.push({
      line: m.code,
      n,
      x0_from_06_m: x0,
      dx_m: dx,
      bbi: p.bbi,
      unit_runs: runs,
      flagged,
      null_zone_i: nullZone,
      start_of_run_last_i: startLast,
    });
  }

  // V12: pasangan tanpa titik hanya boleh di fixture
  if (opt.requireCompleteTrace) {
    for (const forUnit of pairsByUnit.values()) {
      for (const pair of forUnit.values()) {
        if (!pairsWithRun.has(pair)) add("error", "V12", `${pair.value.line}: this row has no points in ${pointsT.name}.`, pairsT.name, pair.row);
      }
    }
  }

  // ---- per unit
  const ru = reader(unitsT);
  if (unitsT.rows.length !== opt.nUnits) add("error", "V2", `${unitsT.rows.length} rows, expected ${opt.nUnits} units.`, unitsT.name);
  const unitsByNumber = new Map<number, BbiUnit>();
  for (const r of unitsT.rows) {
    const k = ru.unit(r);
    if (k < 1 || k > opt.nUnits || !Number.isInteger(k)) add("error", "V2", `unit_web ${k} is outside 1..${opt.nUnits}.`, unitsT.name, r.line);
    if (unitsByNumber.has(k)) add("error", "V2", `unit_web ${k} appears twice.`, unitsT.name, r.line);

    const forUnit = pairsByUnit.get(k);
    const nLines = ru.need(r, "jumlah_garis");
    if (nLines !== (forUnit?.size ?? 0)) add("error", "V5", `unit ${k}: jumlah_garis ${nLines} differs from ${forUnit?.size ?? 0} rows in ${pairsT.name}.`, unitsT.name, r.line);

    const bbi = ru.num(r, "bbi_maks");
    const zone = ru.zone(r, bbi);
    let governing: BbiGoverning | null = null;
    if (bbi !== null) {
      if (zone === null) add("error", "V7", `unit ${k} is covered but has no zone.`, unitsT.name, r.line);
      // V6: governing diambil dari CSV, tidak dihitung ulang; yang dicek hanya kecocokannya.
      const values = [...(forUnit?.values() ?? [])].map((p) => p.value.bbi_max as number);
      const max = values.length > 0 ? Math.max(...values) : -Infinity;
      const source = ru.str(r, "garis_penentu");
      const chosen = forUnit?.get(source);
      const diff = Math.abs(bbi - max);
      if (values.length > 0) maxDiffV6 = Math.max(maxDiffV6, diff);
      if (diff > TOL_BBI) add("error", "V6", `unit ${k}: bbi_maks ${bbi} differs from the maximum of its lines (${values.length > 0 ? max : "none"}).`, unitsT.name, r.line);
      if (!chosen || Math.abs((chosen.value.bbi_max as number) - max) > TOL_BBI) add("error", "V6", `unit ${k}: garis_penentu "${source}" does not reach the unit maximum.`, unitsT.name, r.line);
      governing = {
        line: shortLine(source),
        bbi,
        zone: zone ?? "Acceptable",
        h_cm: ru.need(r, "h_cm"),
        bump_length_m: ru.need(r, "panjang_bump_m"),
        straightedge_m: ru.need(r, "straightedge_m"),
        start_of_run: isStartOfRun(ru.str(r, "catatan")),
      };
      if (bbi > BBI_LIMIT && governing.start_of_run) add("warn", "V17", `Unit ${k}: BBI above 1.0 lies in the first 120 m of a run (straightedge not complete).`);
    } else if (forUnit && forUnit.size > 0) {
      add("error", "V6", `unit ${k} has lines but an empty bbi_maks.`, unitsT.name, r.line);
    }

    unitsByNumber.set(k, {
      unit: k,
      unit_source: ru.need(r, "unit_lama"),
      x_from_06_start_m: ru.need(r, "jarak_dari_06_awal_m"),
      x_from_06_end_m: ru.need(r, "jarak_dari_06_akhir_m"),
      station_from_24_start_m: ru.need(r, "stasiun_awal_m"),
      station_from_24_end_m: ru.need(r, "stasiun_akhir_m"),
      lines_measured: forUnit?.size ?? 0,
      governing,
      lines: meta.map((m): BbiUnitLine => {
        const p = forUnit?.get(m.source_name);
        if (!p) {
          return { line: m.code, bbi_max: null, zone: null, h_cm: null, bump_length_m: null, straightedge_m: null, x_from_06_m: null, x_profaa_m: null, pct_over_1: null, n_points: 0, start_of_run: false };
        }
        return p.value;
      }),
      g_flag: governing ? governing.bbi > BBI_LIMIT : null,
    });
  }
  const units = [...unitsByNumber.values()].sort((a, b) => a.unit - b.unit);
  for (let k = 1; k <= opt.nUnits; k++) if (!unitsByNumber.has(k)) add("error", "V2", `unit ${k} is missing.`, unitsT.name);

  const notCovered = units.filter((u) => !u.governing).map((u) => u.unit);
  if (notCovered.length > 0.02 * opt.nUnits) add("warn", "V16", `${notCovered.length} of ${opt.nUnits} units are not covered by any line (more than 2%).`);

  // ---- laporan berkas selalu ada, juga kalau ada error
  const fileRows = ROLES.map((role) => {
    const t = tables[role] as Table;
    return { role, name: t.name, sha256: opt.sha256?.[t.name] ?? "", rows: t.rows.length };
  });
  report.push("Files");
  for (const f of fileRows) report.push(`  ${f.role}: ${f.name} · ${f.sha256 ? `${f.sha256.slice(0, 12)} · ` : ""}${f.rows} rows`);
  if (issues.some((i) => i.level === "error")) return finish(null, null);

  // ---- hasil
  const [end0, end1] = opt.runway === "06-24" ? ["06", "24"] : ["07L", "25R"];
  const firstPoint = pointsT.rows[0];
  const length = BBI_AXIS_LENGTH_M[opt.runway] ?? Math.round((rt.need(firstPoint, "stasiun_m") + rt.need(firstPoint, "jarak_dari_06_m")) * 100) / 100;
  const data: BbiRunwayData = {
    schema_version: 1,
    kind: "bbi-units",
    runway: opt.runway,
    survey: opt.survey,
    unit_numbering: `Unit 1 at threshold ${end0}; unit = ${opt.nUnits} + 1 − unit_source (unit_source is the numbering of the MATLAB package, unit 1 at threshold ${end1}).`,
    axis: {
      length_m: length,
      x_rule: `x = distance along the runway axis from threshold ${end0} = ${length} − station.`,
      station_rule: `station = distance along the runway axis from the outer edge of threshold ${end1}; falls as the unit number rises.`,
    },
    thresholds: { acceptable_max: BBI_LIMIT as 1, ref: "FAA AC 150/5380-9" },
    g_rule: { threshold: BBI_LIMIT as 1, comparator: ">", note: "g_flag = governing BBI > 1.0 (strict). Stored for the SKG consequence axis; not used in the risk calculation yet." },
    processing: {
      passes_used: [...new Set(meta.map((m) => m.pass))],
      trimmed_end_m: BBI_TRIMMED_END_M,
      start_of_run_m: BBI_START_OF_RUN_M,
      corrections: CORRECTIONS,
      caveats: CAVEATS,
    },
    coverage: { n_units_total: opt.nUnits, n_units_covered: opt.nUnits - notCovered.length, not_covered: notCovered },
    lines: meta,
    units,
    source: {
      kind: opt.sourceKind,
      ...(opt.sourceKind === "admin-import" ? { imported_at: new Date().toISOString() } : {}),
      files: fileRows,
    },
  };
  const trace: BbiRunwayTrace = {
    schema_version: 1,
    kind: "bbi-trace",
    runway: opt.runway,
    survey_id: opt.survey.id,
    source_units_file: `bbi-${opt.runway}-${opt.survey.date.slice(0, 4)}.json`,
    spacing_profaa_m: 0.25,
    x_rule: "x_i = x0_from_06_m + i * dx_m",
    lines: traces,
  };

  report.push(...reportLines(data, nPoints, zoneCounts));
  report.push(`Flagged points: ${flaggedNotes.join("; ") || "none"}`);
  report.push(`Largest x error (V10): ${maxReconstruct.toFixed(4)} m`);
  report.push(`Largest differences: V6 ${maxDiffV6.toFixed(5)}, V12 ${maxDiffV12.toFixed(5)}, V13 ${opt.requireCompleteTrace ? maxDiffV13.toFixed(5) : "skipped"}`);
  return finish(data, trace);
}

function reportLines(data: BbiRunwayData, nPoints: number, zones: Record<BbiZone | "empty", number>): string[] {
  const s = summarizeBbi(data);
  const ranges = (units: number[]) => unitRanges(units).join(", ");
  const unitsWhere = (f: (u: BbiUnit) => boolean | undefined) => data.units.filter(f).map((u) => u.unit);
  const measured = [...new Set(data.units.map((u) => u.lines_measured))].sort((a, b) => b - a).map((n) => {
    const list = unitsWhere((u) => u.lines_measured === n);
    return `${n} → ${list.length} (${ranges(list)})`;
  });
  const rows = data.units.flatMap((u) => u.lines.filter((l) => l.bbi_max !== null));
  const startGov = unitsWhere((u) => u.governing?.start_of_run);
  const zoneOf = (z: BbiZone) => unitsWhere((u) => u.governing?.zone === z).length;
  const gTrue = unitsWhere((u) => u.g_flag === true);
  const governingCounts = data.lines
    .map((l) => [l.code, unitsWhere((u) => u.governing?.line === l.code).length] as const)
    .sort((a, b) => b[1] - a[1]);
  const out = [
    `Units: ${data.coverage.n_units_total}; covered ${data.coverage.n_units_covered}; not covered ${ranges(data.coverage.not_covered) || "none"}`,
    `lines_measured: ${measured.join("; ")}`,
    `Unit-line rows: ${rows.length}; start_of_run ${rows.filter((l) => l.start_of_run).length}`,
    `Governing start_of_run: ${startGov.length} units (${ranges(startGov)})`,
    `Zones per unit: Acceptable ${zoneOf("Acceptable")}, Excessive ${zoneOf("Excessive")}, Unacceptable ${zoneOf("Unacceptable")}`,
  ];
  const max = s.max;
  if (max?.governing) {
    const g = max.governing;
    const line = max.lines.find((l) => l.line === g.line);
    const over = line?.pct_over_1 != null ? Math.round((line.pct_over_1 / 100) * line.n_points) : 0;
    out.push(
      `Max BBI: ${g.bbi.toFixed(4)} at unit ${max.unit}, line ${g.line}, ${g.zone}, H ${g.h_cm.toFixed(2)} cm, L ${g.bump_length_m.toFixed(2)} m, straightedge ${g.straightedge_m.toFixed(2)} m, ${line?.x_from_06_m ?? "—"} m from threshold, pct_over_1 ${line?.pct_over_1 ?? "—"}% (${over} of ${line?.n_points ?? 0} points)`,
    );
  }
  out.push(
    `Units above 1.0: ${s.aboveLimit}`,
    `g_flag: true ${gTrue.length} (${ranges(gTrue) || "none"}), false ${unitsWhere((u) => u.g_flag === false).length}, null ${unitsWhere((u) => u.g_flag === null).length}`,
    `Unit BBI: median ${s.median?.toFixed(4)}, mean ${s.mean?.toFixed(5)}, minimum ${s.min?.governing?.bbi.toFixed(4)} (unit ${s.min?.unit})`,
    `Display classes: ${BBI_CLASSES.map((c) => `${c} ${s.classCounts[c]}`).join(", ")}`,
    `Governing line: ${governingCounts.map(([c, n]) => `${c} ${n}`).join(", ")}`,
    `Per line (mean / max / unit of max): ${data.lines.map((l) => `${l.code} ${l.bbi_mean.toFixed(4)} / ${l.bbi_max.toFixed(4)} / ${l.max_unit}`).join(" · ")}`,
    `Trace points: ${nPoints}; zones Acceptable ${zones.Acceptable}, Excessive ${zones.Excessive}, Unacceptable ${zones.Unacceptable}, empty ${zones.empty}`,
    `Axis length: ${data.axis.length_m} m`,
  );
  return out;
}
