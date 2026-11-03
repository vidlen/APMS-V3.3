/**
 * bbi-import.test.ts — modul konversi dan berkas seed BBI (brief §10.2 uji A-G). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BbiRunwaySchema, BbiTraceSchema } from "./bbi-schema.ts";
import { bbiSurvey, buildBbi, detectRole, parseDecimal, type BbiInputFile, type Issue } from "./bbi-import.ts";
import { summarizeBbi, traceX } from "./bbi.ts";
import type { BbiLineTrace, BbiUnit } from "../types/bbi.ts";

const FX = ["bbi_per_unit_web.csv", "bbi_per_unit_garis_web.csv", "ringkasan_garis_web.csv", "bbi_per_titik_web_unit198-200.csv"];
const OLD = "bbi_per_unit_lama_cuplikan.csv";
const BOM = String.fromCharCode(0xfeff);
const fixture = (name: string): string => readFileSync(fileURLToPath(new URL(`./__fixtures__/bbi/${name}`, import.meta.url)), "utf-8");
const files = (): BbiInputFile[] => FX.map((name) => ({ name, text: fixture(name) }));

const build = (input: BbiInputFile[], requireCompleteTrace = false) =>
  buildBbi(input, {
    runway: "06-24",
    nUnits: 300,
    survey: bbiSurvey({ id: "2026-06", label: "Jun 2026", date: "2026-06-28", lcms: "2062903736" }),
    sourceKind: "seed",
    requireCompleteTrace,
  });
const errors = (issues: Issue[]) => issues.filter((i) => i.level === "error");
const edit = (name: string, change: (text: string) => string): BbiInputFile[] =>
  files().map((f) => (f.name === name ? { ...f, text: change(f.text) } : f));

test("A. pembacaan: desimal, BOM, LF, dan peran dari kepala kolom", () => {
  assert.equal(parseDecimal("1,1871"), 1.1871);
  assert.equal(parseDecimal("-3,6"), -3.6);
  assert.equal(parseDecimal("0"), 0);
  assert.equal(parseDecimal(""), null);
  assert.throws(() => parseDecimal("abc"));
  assert.throws(() => parseDecimal("1.5"), "titik desimal bukan format paket ini");

  const head = (name: string) => fixture(name).split(/\r?\n/)[0];
  assert.deepEqual(FX.map((n) => detectRole(head(n))), ["units", "unit-lines", "lines", "points"]);
  assert.equal(detectRole(head(OLD)), "old-numbering");
  assert.equal(detectRole(`${BOM}${head(FX[0])}`), "units", "BOM dibuang");
  assert.equal(detectRole("a;b;c"), "unknown");

  const old = build([...files().slice(1), { name: OLD, text: fixture(OLD) }]);
  assert.equal(old.units, null);
  const expected = `${OLD} uses the old unit numbering (unit 1 at threshold 24). Run node konversi_unit_web.mjs in the BBI package and upload the *_web.csv files.`;
  assert.ok(old.issues.some((i) => i.message === expected), "pesan penolakan berkas lama");

  const bomLf = build(files().map((f) => ({ ...f, text: `${BOM}${f.text.replace(/\r\n/g, "\n")}\n\n` })));
  assert.deepEqual(errors(bomLf.issues), [], "BOM, LF, dan baris kosong di akhir diterima");
});

test("C. rekonsiliasi pada fixture titik: V12 lolos untuk unit 198-200, hasil lolos skema", () => {
  const b = build(files());
  assert.deepEqual(errors(b.issues), []);
  assert.ok(b.units && b.trace);
  assert.equal(b.roles[FX[3]], "points");
  BbiRunwaySchema.parse(b.units);
  BbiTraceSchema.parse(b.trace);

  assert.equal(b.units.lines.length, 8);
  assert.deepEqual(b.units.lines.map((l) => l.code), ["P01_L", "P01_R", "P02_L", "P02_R", "P03_L", "P03_R", "P05_L", "P05_R"]);
  for (const t of b.trace.lines) {
    assert.equal(t.n, 120, `${t.line}: 40 titik × 3 unit`);
    assert.deepEqual(t.unit_runs.map((r) => r[0]).sort(), [198, 199, 200]);
    const meta = b.units.lines.find((l) => l.code === t.line);
    assert.equal(Math.sign(t.dx_m), meta?.direction === "E" ? 1 : -1);
    for (const [u, a, c] of t.unit_runs) {
      const line = b.units.units[u - 1].lines.find((l) => l.line === t.line);
      assert.equal(line?.bbi_max, Math.max(...t.bbi.slice(a, c + 1)), `${t.line} unit ${u}`);
      assert.equal(line?.n_points, c - a + 1);
    }
  }
  const u199 = b.units.units[198];
  assert.equal(u199.governing?.line, "P02_L");
  assert.equal(u199.governing?.bbi, 1.1871);
  assert.equal(u199.g_flag, true);
  assert.equal(u199.unit_source, 102);
  assert.equal(b.units.units[0].governing, null);
  assert.equal(b.units.units[0].g_flag, null);
});

test("G. error: berkas hilang, V3, V6, pemisah salah", () => {
  const missing = build(files().slice(0, 3));
  assert.equal(missing.units, null);
  assert.ok(errors(missing.issues).some((i) => /Missing the points file/.test(i.message)));

  const wrongUnit = build(edit(FX[0], (t) => t.replace("\n199;102;", "\n198;102;")));
  assert.equal(wrongUnit.units, null);
  assert.ok(errors(wrongUnit.issues).some((i) => i.check === "V3"));

  const wrongMax = build(edit(FX[1], (t) => t.replace("RWY0624_P02_L;W;5,4;1,1871;", "RWY0624_P02_L;W;5,4;1,5000;")));
  assert.equal(wrongMax.units, null);
  assert.ok(errors(wrongMax.issues).some((i) => i.check === "V6"));

  const comma = build(edit(FX[2], (t) => t.replaceAll(";", ",")));
  assert.equal(comma.units, null);
  assert.ok(errors(comma.issues).some((i) => i.message === `${FX[2]}: expected ';' as column separator (Indonesian-locale CSV from the BBI package).`));
});

test("V9, V11, V14: urutan titik, run ganda, dan arah garis", () => {
  const dropOne = build(edit(FX[3], (t) => {
    const rows = t.split("\r\n");
    rows.splice(10, 1);
    return rows.join("\r\n");
  }));
  assert.ok(errors(dropOne.issues).some((i) => i.check === "V9"), "titik hilang = celah");

  // Tukar nomor unit satu titik di tengah run unit 198: unit 199 muncul dua kali di garis itu.
  const splitRun = build(edit(FX[3], (t) => {
    const rows = t.split("\r\n");
    rows[20] = rows[20].replace(/^198;103;/, "199;102;");
    return rows.join("\r\n");
  }));
  assert.ok(errors(splitRun.issues).some((i) => i.check === "V11"));

  const wrongDir = build(edit(FX[2], (t) => t.replace("RWY0624_P02_L;W;", "RWY0624_P02_L;E;")));
  assert.ok(errors(wrongDir.issues).some((i) => i.check === "V14"));
});

test("requireCompleteTrace: fixture titik tidak lengkap ditolak, V13 hanya berlaku di mode lengkap", () => {
  const b = build(files(), true);
  assert.equal(b.units, null);
  assert.ok(errors(b.issues).some((i) => i.check === "V12"));
  assert.ok(errors(b.issues).some((i) => i.check === "V13"));
  assert.ok(b.issues.some((i) => /more not shown/.test(i.message)), "pesan dibatasi per cek");
});

// ---- Berkas seed (brief §10.2 uji B-F, §10.3)
const seedRaw = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/data/${name}`, import.meta.url)), "utf-8"));
const seed = BbiRunwaySchema.parse(seedRaw("bbi-06-24-2026.json"));
const seedTrace = BbiTraceSchema.parse(seedRaw("bbi-06-24-2026-trace.json"));
const lineMeta = (code: string) => seed.lines.find((l) => l.code === code)!;

test("F. kedua berkas seed lolos skema", () => {
  assert.equal(seed.kind, "bbi-units");
  assert.equal(seedTrace.kind, "bbi-trace");
  assert.equal(seedTrace.source_units_file, "bbi-06-24-2026.json");
  assert.deepEqual(seedTrace.lines.map((l) => l.line), seed.lines.map((l) => l.code));
});

test("B. penomoran = geometri web: unit BBI cocok dengan poligon, unit 1 di ujung barat", () => {
  type Feature = { id: number; geometry: { coordinates: number[][][] } };
  const web = (seedRaw("runway-06-24-units-2026.json") as { features: Feature[] }).features;
  const byId = new Map(web.map((f) => [f.id, f]));
  const centroid = (k: number) => {
    const ring = byId.get(k)!.geometry.coordinates[0].slice(0, -1);
    return [0, 1].map((a) => ring.reduce((s, p) => s + p[a], 0) / ring.length);
  };
  assert.ok(centroid(1)[0] < centroid(300)[0], "bujur unit 1 < bujur unit 300");

  // Meter lokal memakai jari-jari elipsoid WGS84 di lintang runway.
  const lat = (centroid(150)[1] * Math.PI) / 180;
  const w = Math.sqrt(1 - 0.00669438 * Math.sin(lat) ** 2);
  const toM = ([lon, la]: number[]) => [((6378137 / w) * Math.cos(lat) * lon * Math.PI) / 180, ((6378137 * (1 - 0.00669438)) / w ** 3 * la * Math.PI) / 180];
  const a = toM(centroid(1));
  const b = toM(centroid(300));
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const along = (k: number) => {
    const q = toM(centroid(k));
    return ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1])) / len;
  };
  const mid = (k: number) => (seed.units[k - 1].x_from_06_start_m + seed.units[k - 1].x_from_06_end_m) / 2;
  let worst = 0;
  for (const u of seed.units) {
    if (u.governing) worst = Math.max(worst, Math.abs(along(u.unit) - (mid(u.unit) - mid(1))));
  }
  assert.ok(worst < 0.5, `selisih terbesar ${worst.toFixed(3)} m`);
  assert.ok(seed.units.every((u) => u.unit + u.unit_source === 301), "unit = 301 − unit_source");
});

test("C. rekonsiliasi seed: governing, lines_measured, dan titik per run", () => {
  for (const u of seed.units) {
    const values = u.lines.flatMap((l) => (l.bbi_max === null ? [] : [l.bbi_max]));
    assert.equal(u.lines_measured, values.length, `unit ${u.unit}`);
    if (u.governing) assert.equal(u.governing.bbi, Math.max(...values), `unit ${u.unit}`);
    else assert.equal(values.length, 0, `unit ${u.unit}`);
  }
  for (const t of seedTrace.lines) {
    const k = seed.lines.findIndex((l) => l.code === t.line);
    assert.equal(seed.lines[k].bbi_max, t.bbi.reduce((a, b) => Math.max(a, b), 0), `${t.line}: maks meta = maks trace`);
    for (const [unit, a, b] of t.unit_runs) {
      const l = seed.units[unit - 1].lines[k];
      assert.equal(l.n_points, b - a + 1, `${t.line} unit ${unit}`);
      assert.equal(l.bbi_max, Math.max(...t.bbi.slice(a, b + 1)), `${t.line} unit ${unit}`);
    }
  }
});

test("E. trace: rekonstruksi x, arah, run kontigu, dan titik flagged", () => {
  const counts: Record<string, number> = { P01_L: 271, P01_R: 271, P02_L: 271, P02_R: 271, P03_L: 270, P03_R: 270, P05_L: 270, P05_R: 270 };
  for (const t of seedTrace.lines) {
    const m = lineMeta(t.line);
    assert.ok(Math.abs(t.x0_from_06_m + (t.n - 1) * t.dx_m - m.x_last_from_06_m) <= 0.01, t.line);
    assert.equal(t.x0_from_06_m, m.x_first_from_06_m);
    assert.equal(Math.sign(t.dx_m), m.direction === "E" ? 1 : -1, t.line);
    assert.equal(t.unit_runs.length, counts[t.line], `${t.line}: jumlah run`);
    assert.equal(new Set(t.unit_runs.map((r) => r[0])).size, t.unit_runs.length, `${t.line}: unit ganda`);
    let next = 0;
    for (const [, a, b] of t.unit_runs) {
      assert.equal(a, next, t.line);
      next = b + 1;
    }
    assert.equal(next, t.n, `${t.line}: run menutup 0..n-1`);
    assert.deepEqual(t.flagged.map((f) => f.i), t.bbi.flatMap((v, i) => (v > 1 ? [i] : [])), `${t.line}: flagged = bbi > 1`);
    assert.equal(t.start_of_run_last_i, 479, `${t.line}: x_profaa 119,75 m`);
    assert.equal(t.null_zone_i.length, 2, `${t.line}: titik pertama dan terakhir`);
    assert.deepEqual(t.null_zone_i, [0, t.n - 1]);
  }
  const dx = Object.fromEntries(seedTrace.lines.map((t) => [t.line.slice(0, 3), t.dx_m]));
  assert.ok(Math.abs(dx.P01 - 0.250013) < 1e-6 && Math.abs(dx.P02 + 0.250049) < 1e-6 && Math.abs(dx.P03 - 0.250113) < 1e-6 && Math.abs(dx.P05 - 0.250152) < 1e-6);
});

test("D. angka penerimaan brief §10.3", () => {
  const s = summarizeBbi(seed);
  const unitsWhere = (f: (u: BbiUnit) => boolean | undefined) => seed.units.filter(f).map((u) => u.unit);
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

  assert.equal(seed.units.length, 300);
  assert.equal(seed.coverage.n_units_covered, 294);
  assert.deepEqual(seed.coverage.not_covered, [1, 2, 3, 298, 299, 300]);
  assert.deepEqual(unitsWhere((u) => u.lines_measured === 8), range(27, 273));
  assert.deepEqual(unitsWhere((u) => u.lines_measured === 6), range(4, 26));
  assert.deepEqual(unitsWhere((u) => u.lines_measured === 4), [274]);
  assert.deepEqual(unitsWhere((u) => u.lines_measured === 2), range(275, 297));
  assert.equal(unitsWhere((u) => u.lines_measured === 0).length, 6);

  const rows = seed.units.flatMap((u) => u.lines.filter((l) => l.bbi_max !== null));
  assert.equal(rows.length, 2164);
  assert.equal(rows.filter((l) => l.start_of_run).length, 99);
  assert.deepEqual(unitsWhere((u) => u.governing?.start_of_run), [...range(4, 16), ...range(285, 297)]);
  assert.equal(unitsWhere((u) => u.governing?.zone === "Acceptable").length, 293);
  assert.deepEqual(unitsWhere((u) => u.governing?.zone === "Excessive"), [199]);
  assert.equal(unitsWhere((u) => u.governing?.zone === "Unacceptable").length, 0);

  const u199 = s.max!;
  assert.equal(u199.unit, 199);
  assert.deepEqual(u199.governing, { line: "P02_L", bbi: 1.1871, zone: "Excessive", h_cm: 2.5, bump_length_m: 0.5, straightedge_m: 2.25, start_of_run: false });
  const p02l = u199.lines.find((l) => l.line === "P02_L")!;
  assert.equal(p02l.x_from_06_m, 1983.7);
  assert.equal(p02l.pct_over_1, 22.5);
  assert.equal(p02l.n_points, 40);
  assert.equal(s.aboveLimit, 1);

  assert.deepEqual(unitsWhere((u) => u.g_flag === true), [199]);
  assert.equal(unitsWhere((u) => u.g_flag === false).length, 293);
  assert.equal(unitsWhere((u) => u.g_flag === null).length, 6);

  assert.ok(Math.abs(s.median! - 0.3571) < 5e-5, `median ${s.median}`);
  assert.ok(Math.abs(s.mean! - 0.38358) < 5e-6, `rata-rata ${s.mean}`);
  assert.equal(s.min?.unit, 297);
  assert.equal(s.min?.governing?.bbi, 0.1147);
  assert.deepEqual(s.classCounts, { b0: 13, b1: 173, b2: 91, b3: 11, b4: 5, excessive: 1, unacceptable: 0, noData: 6 });

  const gov: Record<string, number> = { P02_L: 63, P01_L: 47, P03_L: 47, P02_R: 42, P03_R: 28, P01_R: 25, P05_L: 24, P05_R: 18 };
  for (const [code, n] of Object.entries(gov)) assert.equal(unitsWhere((u) => u.governing?.line === code).length, n, code);

  const perLine: Record<string, [number, number, number]> = {
    P01_L: [0.2448, 0.7277, 126], P01_R: [0.2201, 0.7684, 201], P02_L: [0.2525, 1.1871, 199], P02_R: [0.235, 0.8465, 201],
    P03_L: [0.2451, 0.8783, 179], P03_R: [0.2388, 0.6698, 201], P05_L: [0.2084, 0.7889, 122], P05_R: [0.2184, 0.6203, 130],
  };
  for (const [code, [mean, max, unit]] of Object.entries(perLine)) {
    const m = lineMeta(code);
    assert.deepEqual([m.bbi_mean, m.bbi_max, m.max_unit], [mean, max, unit], code);
  }

  const n = seedTrace.lines.reduce((sum, t) => sum + t.n, 0);
  assert.equal(n, 86236);
  assert.equal(seedTrace.lines.reduce((sum, t) => sum + t.null_zone_i.length, 0), 16);
  assert.deepEqual(seedTrace.lines.filter((t) => t.flagged.length > 0).map((t) => t.line), ["P02_L"]);
  const t = seedTrace.lines.find((l) => l.line === "P02_L")!;
  assert.equal(t.flagged.length, 9);
  assert.ok(t.flagged.every((f) => f.zone === "Excessive" && unitAtIndex(t, f.i) === 199));
  const xs = t.flagged.map((f) => traceX(t, f.i));
  assert.ok(Math.abs(Math.min(...xs) - 1982.41) < 0.01 && Math.abs(Math.max(...xs) - 1985.66) < 0.01, `${Math.min(...xs)}–${Math.max(...xs)}`);
  assert.equal(seed.axis.length_m, 2999.304);
  assert.deepEqual(seed.processing.passes_used, [1, 2, 3, 5]);
  assert.deepEqual(seed.source.files.map((f) => [f.role, f.sha256.slice(0, 12), f.rows]), [
    ["units", "04eb1e0e45ac", 300],
    ["unit-lines", "0af54fa42ebb", 2164],
    ["lines", "93de10b4c0ce", 8],
    ["points", "a2ff3eaee42c", 86236],
  ]);
});

const unitAtIndex = (t: BbiLineTrace, i: number) => t.unit_runs.find(([, a, b]) => i >= a && i <= b)?.[0];
