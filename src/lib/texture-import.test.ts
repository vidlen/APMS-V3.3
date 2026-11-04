/**
 * texture-import.test.ts — modul konversi dan berkas seed tekstur (brief tekstur §10.2 uji A-D, F-H). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TextureRunwaySchema } from "./texture-schema.ts";
import { buildTexture, detectRole, detectRunway, parseDecimal, textureSurvey, type Issue, type TextureInputFile } from "./texture-import.ts";
import { faaLevel } from "../config/texture.ts";
import { hasHighKeel, summarizeTexture } from "./texture.ts";
import type { RunwayId } from "../types/skid.ts";
import type { TextureRunwayData, TextureUnit } from "../types/texture.ts";

const BOM = String.fromCharCode(0xfeff);
const fixture = (name: string): string => readFileSync(fileURLToPath(new URL(`./__fixtures__/texture/${name}`, import.meta.url)), "utf-8");
const head = (name: string): string => fixture(name).split(/\r?\n/)[0];

const FX_0624 = ["tekstur_per_band_0624_cuplikan.csv", "cek_per_unit_0624.csv", "ringkasan_lintasan_0624.csv", "cek_foto_0624.csv"];
const FX_07L = ["tekstur_per_band_07L25R_cuplikan.csv", "cek_per_unit_07L25R.csv", "ringkasan_lintasan_07L25R.csv"];
const RAW = "lcms_mentah_kepala.csv";
const UNITS_0624 = [1, 2, 3, 13, 14, 15, 31, 32];
const UNITS_07L = [6, 7, 8];

const files = (names: string[] = FX_0624): TextureInputFile[] => names.map((name) => ({ name, text: fixture(name) }));
const build = (input: TextureInputFile[], runway: RunwayId = "06-24", checkUnits: number[] = UNITS_0624) =>
  buildTexture(input, {
    runway,
    nUnits: runway === "06-24" ? 300 : 360,
    survey: textureSurvey({ id: "2026-06", label: "Jun 2026", date: runway === "06-24" ? "2026-06-28" : "2026-06-18" }),
    sourceKind: "seed",
    requireComplete: false,
    checkUnits,
  });
const errors = (issues: Issue[]) => issues.filter((i) => i.level === "error");
const checks = (issues: Issue[]) => errors(issues).map((i) => i.check);
const edit = (name: string, change: (text: string) => string): TextureInputFile[] =>
  files().map((f) => (f.name === name ? { ...f, text: change(f.text) } : f));

/** Mengganti satu kolom pada baris pertama yang lolos `when`. */
function editBandRow(when: (cells: string[], col: (c: string) => string) => boolean, column: string, value: string): TextureInputFile[] {
  return edit(FX_0624[0], (text) => {
    const lines = text.split("\r\n");
    const header = lines[0].split(";");
    const i = lines.findIndex((l, k) => {
      if (k === 0 || l === "") return false;
      const cells = l.split(";");
      return when(cells, (c) => cells[header.indexOf(c)]);
    });
    assert.ok(i > 0, "baris yang diubah harus ada");
    const cells = lines[i].split(";");
    cells[header.indexOf(column)] = value;
    lines[i] = cells.join(";");
    return lines.join("\r\n");
  });
}

test("A. pembacaan: desimal, BOM, LF, peran dan runway dari kepala kolom", () => {
  assert.equal(parseDecimal("1,034"), 1.034);
  assert.equal(parseDecimal("-0,57"), -0.57);
  assert.equal(parseDecimal("13"), 13);
  assert.equal(parseDecimal(""), null);
  assert.throws(() => parseDecimal("abc"));
  assert.throws(() => parseDecimal("1.5"), "titik desimal bukan format paket ini");

  assert.deepEqual(
    [...FX_0624, ...FX_07L, RAW].map((n) => detectRole(head(n))),
    ["bands", "units-check", "passes", "photo-check", "bands", "units-check", "passes", "raw-lcms"],
  );
  assert.equal(detectRole(`${BOM}${head(FX_0624[1])}`), "units-check", "BOM dibuang");
  assert.equal(detectRole("a;b;c"), "unknown");

  for (const n of FX_0624) assert.equal(detectRunway(head(n)), "06-24", n);
  for (const n of FX_07L) assert.equal(detectRunway(head(n)), "07L-25R", n);
  assert.equal(detectRunway("stasiun_dari_24_m;mpd_mm"), null, "stasiun_dari_* tidak menentukan runway");

  const raw = build([{ name: RAW, text: fixture(RAW) }, ...files()]);
  assert.equal(raw.data, null);
  assert.equal(raw.roles[RAW], "raw-lcms");
  const expected = `${RAW} is the raw LCMS texture export. Run olah_tekstur.m in the TEKSTUR_2026 package and upload the files from hasil\\0624\\.`;
  assert.ok(raw.issues.some((i) => i.message === expected), "pesan penolakan CSV mentah");

  const bomLf = build(files().map((f) => ({ ...f, text: `${BOM}${f.text.replace(/\r\n/g, "\n")}\n\n` })));
  assert.deepEqual(errors(bomLf.issues), [], "BOM, LF, dan baris kosong di akhir diterima");
});

test("C, F. fixture: V11 lolos untuk unit cuplikan, hasil lolos skema", () => {
  const a = build(files());
  assert.deepEqual(errors(a.issues), []);
  assert.ok(a.data);
  TextureRunwaySchema.parse(a.data);
  assert.equal(a.data.survey.lcms_survey_id, "2062903736", "dari kolom gambar");
  assert.equal(a.data.axis.length_m, 2999.43);
  assert.equal(a.data.units[0].keel.mpd_mm, null, "unit 1 tanpa nilai keel");
  assert.equal(a.data.units[0].k_flags.planning, null);

  const u14 = a.data.units[13];
  assert.equal(u14.keel.n, 22);
  assert.ok(Math.abs((u14.keel.etd_mm as number) - 0.6865) < 5e-5);
  assert.equal(u14.keel.etd_mm?.toFixed(3), "0.687", "6 desimal: tidak ada pembulatan ganda");
  assert.equal(u14.x_mid_m, 134.9);
  assert.deepEqual(u14.k_flags, { minimum: false, planning: true });
  assert.deepEqual(u14.passes, [1, 2, 3, 4, 5, 7].map((pass, i) => ({ pass, n_keel: [5, 5, 5, 2, 3, 2][i] })));
  assert.equal(u14.high_values.length, 7);
  assert.deepEqual(u14.high_values.slice(0, 2).map((v) => [v.x_m, v.band, v.pass, v.offset_m, v.mpd_mm]), [[131.3, 4, 10, 15.67, 2.01], [131.3, 5, 10, 14.97, 2.46]], "urut x_m lalu band");

  const b = build(files(FX_07L), "07L-25R", UNITS_07L);
  assert.deepEqual(errors(b.issues), []);
  assert.ok(b.data);
  TextureRunwaySchema.parse(b.data);
  assert.equal(b.data.survey.lcms_survey_id, "2061902896");
  assert.equal(b.data.units[6].keel.n, 17);
  assert.equal(b.data.zones[0].label, "07L end");
  assert.equal(b.data.passes[0].direction, "E", "ke 25R = arah E");
});

test("ID survei LCMS: isian lain dipakai dan diberi peringatan", () => {
  const b = buildTexture(files(), {
    runway: "06-24",
    nUnits: 300,
    survey: textureSurvey({ id: "x", label: "x", date: "2026-06-28", lcms: "1111111111" }),
    sourceKind: "admin-import",
    requireComplete: false,
    checkUnits: UNITS_0624,
  });
  assert.equal(b.data?.survey.lcms_survey_id, "1111111111");
  assert.ok(b.issues.some((i) => i.level === "warn" && i.check === "lcms"));
  assert.ok(b.data?.source.imported_at, "admin-import mencatat waktu impor");
});

test("requireComplete: cuplikan ditolak (V10 lolos, V11 dan V12 tidak)", () => {
  const b = buildTexture(files(), {
    runway: "06-24",
    nUnits: 300,
    survey: textureSurvey({ id: "x", label: "x", date: "2026-06-28" }),
    sourceKind: "seed",
    requireComplete: true,
  });
  assert.equal(b.data, null);
  const got = checks(b.issues);
  assert.ok(got.includes("V11") && got.includes("V12") && got.includes("V13"), got.join());
});

test("G. error: berkas hilang, runway salah, V3, V6, V7, V8, V9, V11, pemisah", () => {
  const noPasses = build(files().filter((f) => f.name !== FX_0624[2]));
  assert.equal(noPasses.data, null);
  assert.ok(noPasses.issues.some((i) => i.message === "The passes file is missing."));

  const wrongRunway = build(files(), "07L-25R");
  assert.equal(wrongRunway.data, null);
  assert.ok(wrongRunway.issues.some((i) => i.check === "V2" && i.message === `${FX_0624[0]} is for RWY 06/24, but RWY 07L/25R is selected.`));

  const far = editBandRow((_, col) => col("status") === "valid" && Math.abs(Number(col("offset_m").replace(",", "."))) > 7, "keel", "1");
  assert.ok(checks(build(far).issues).includes("V6"));

  const near = editBandRow((_, col) => col("keel") === "1" && Math.abs(Number(col("offset_m").replace(",", "."))) < 5, "keel", "0");
  assert.ok(checks(build(near).issues).includes("V6"), "nilai valid dekat as harus keel");

  const mpd = editBandRow((_, col) => col("keel") === "1" && col("unit") === "14", "mpd_mm", "1,900");
  const v11 = build(mpd);
  assert.equal(v11.data, null);
  assert.ok(checks(v11.issues).includes("V11"), checks(v11.issues).join());

  const dropout = editBandRow((_, col) => col("status") === "valid", "status", "dropout");
  assert.ok(checks(build(dropout).issues).includes("V7"));

  const photo = editBandRow((_, col) => col("cek_foto") === "1", "cek_foto", "0");
  assert.ok(checks(build(photo).issues).includes("V8"));

  const station = editBandRow((_, col) => col("status") === "valid", "stasiun_dari_24_m", "1000,00");
  assert.ok(checks(build(station).issues).includes("V9"));

  // nilai di luar rentang berhenti sebagai error, bukan melempar exception
  for (const [column, value] of [["unit", "999"], ["band", "6"], ["zona_faa", "7"], ["status", "aneh"]] as const) {
    assert.ok(checks(build(editBandRow(() => true, column, value)).issues).includes("V3"), column);
  }
  assert.ok(checks(build(editBandRow((_, col) => col("unit") === "14", "zona_faa", "2")).issues).includes("V4"));

  const seg = edit(FX_0624[0], (text) => text.split("\r\n").filter((_, i) => i !== 1).join("\r\n"));
  assert.ok(checks(build(seg).issues).includes("V5"));

  const comma = edit(FX_0624[0], (text) => text.replaceAll(";", ","));
  const sep = build(comma);
  assert.equal(sep.data, null);
  assert.ok(sep.issues.some((i) => i.message === `${FX_0624[0]}: expected ';' as column separator (Indonesian-locale CSV from the TEKSTUR_2026 package).`));

  const noCol = edit(FX_0624[1], (text) => text.replace("n_lebar_penuh;", ""));
  assert.ok(checks(build(noCol).issues).includes("V1"));
});

test("V12 dilewati pada cuplikan; V14 menolak dropout di atas 20%", () => {
  const passes = edit(FX_0624[2], (text) => text.replace("1;297;", "1;296;"));
  assert.deepEqual(errors(build(passes).issues), [], "V12 dilewati bila requireComplete false");

  const dropped = edit(FX_0624[0], (text) => text.replaceAll(";valid;", ";dropout;"));
  assert.ok(checks(build(dropped).issues).includes("V14"));
});

// ---- berkas seed (brief §10.2 uji B, C, D, F, H; angka §10.3)
const seedRaw = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/data/${name}`, import.meta.url)), "utf-8"));
const seeds: Record<RunwayId, TextureRunwayData> = {
  "06-24": TextureRunwaySchema.parse(seedRaw("texture-06-24-2026.json")),
  "07L-25R": TextureRunwaySchema.parse(seedRaw("texture-07L-25R-2026.json")),
};
const near = (actual: number | null | undefined, expected: number, what: string, tol = 5e-5) =>
  assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) <= tol, `${what}: ${actual}, expected ${expected}`);
const sum = (v: readonly number[]) => v.reduce((a, b) => a + b, 0);
const units = (rw: RunwayId, f: (u: TextureUnit) => boolean) => seeds[rw].units.filter(f).map((u) => u.unit);

test("B. posisi = geometri web: x_mid_m cocok dengan centroid poligon, unit 1 di ujung barat", () => {
  type Feature = { id: number; geometry: { coordinates: number[][][] } };
  for (const rw of ["06-24", "07L-25R"] as const) {
    const web = (seedRaw(`runway-${rw}-units-2026.json`) as { features: Feature[] }).features;
    const data = seeds[rw];
    const N = data.units.length;
    assert.equal(web.length, N);
    const byId = new Map(web.map((f) => [f.id, f]));
    const centroid = (k: number) => {
      const ring = byId.get(k)!.geometry.coordinates[0].slice(0, -1);
      return [0, 1].map((a) => ring.reduce((s, p) => s + p[a], 0) / ring.length);
    };
    assert.ok(centroid(1)[0] < centroid(N)[0], `${rw}: bujur unit 1 < bujur unit ${N}`);

    // Meter lokal memakai jari-jari elipsoid WGS84 di lintang runway.
    const lat = (centroid(N >> 1)[1] * Math.PI) / 180;
    const w = Math.sqrt(1 - 0.00669438 * Math.sin(lat) ** 2);
    const toM = ([lon, la]: number[]) => [((6378137 / w) * Math.cos(lat) * lon * Math.PI) / 180, (((6378137 * (1 - 0.00669438)) / w ** 3) * la * Math.PI) / 180];
    const a = toM(centroid(1));
    const b = toM(centroid(N));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const along = (k: number) => {
      const q = toM(centroid(k));
      return ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1])) / len;
    };
    const x1 = data.units[0].x_mid_m;
    let worst = 0;
    for (const u of data.units) worst = Math.max(worst, Math.abs(along(u.unit) - (u.x_mid_m - x1)));
    assert.ok(worst < 0.5, `${rw}: selisih terbesar ${worst.toFixed(3)} m`);
  }
});

test("C. rekonsiliasi seed: jumlah per unit, zona, lajur, dan ETD = 0,2 + 0,8·MPD", () => {
  for (const rw of ["06-24", "07L-25R"] as const) {
    const d = seeds[rw];
    assert.equal(sum(d.units.map((u) => u.keel.n)), d.runway_keel.n, rw);
    assert.equal(sum(d.zones.map((z) => z.n_keel)), d.runway_keel.n, rw);
    assert.equal(sum(d.units.map((u) => u.full.n)), d.runway_full.n, rw);
    assert.equal(d.runway_full.n, d.qc.valid, rw);
    assert.equal(sum(d.lanes.all.n), d.qc.valid, rw);
    for (const z of d.zones) {
      const inZone = d.units.filter((u) => u.zone === z.zone);
      assert.equal(sum(d.lanes[`zone${z.zone}`].n), sum(inZone.map((u) => u.full.n)), `${rw} zona ${z.zone}`);
      assert.deepEqual([inZone[0].unit, inZone[inZone.length - 1].unit], z.units, `${rw} zona ${z.zone}`);
      near(z.etd_mm, 0.2 + 0.8 * z.mpd_mm, `${rw} zona ${z.zone} ETD`, 2e-6);
    }
    for (const u of d.units) {
      if (u.keel.mpd_mm !== null) near(u.keel.etd_mm, 0.2 + 0.8 * u.keel.mpd_mm, `${rw} unit ${u.unit} ETD keel`, 2e-6);
      if (u.full.mpd_mm !== null) near(u.full.etd_mm, 0.2 + 0.8 * u.full.mpd_mm, `${rw} unit ${u.unit} ETD penuh`, 2e-6);
      assert.equal(sum(u.passes.map((p) => p.n_keel)), u.keel.n, `${rw} unit ${u.unit} passes`);
      assert.ok(Math.abs(u.station_mid_m - (d.axis.length_m - u.x_mid_m)) < 0.051, `${rw} unit ${u.unit} stasiun`);
    }
  }
});

test("D. angka penerimaan §10.3", () => {
  const expected = {
    "06-24": {
      values: 32750, segments: 6550, passes: 23, valid: 32237, dropout: 11, outside: 467, turning: 35, dropoutPct: 0.034, length: 2999.43, keel: 6284,
      noKeel: [1, 299, 300], nPerUnit: [12, 21, 24], keelMpd: 1.007, keelEtd: 1.0056, fullMpd: 0.7647, fullEtd: 0.8117,
      zones: [[2028, 1.0341, 1.0273], [2101, 0.9496, 0.9597], [2155, 1.0374, 1.0299]],
      minUnit: [[14, 0.6865], [152, 0.8011], [295, 0.7305]], below: [7, 0, 7], above: [13, 19, 18],
      etd: [0.6865, 14, 0.9916, 1.76, 32], belowUnits: [5, 6, 11, 12, 13, 14, 15, 283, 284, 285, 286, 287, 289, 295],
      classes: { ok: 50, d4: 31, d3: 93, d2: 60, d1: 49, plan: 14, gap: 0, correct: 0, noData: 3 },
      fullRange: [0.6981, 1.2462], high: [262, 110], highUnits: 42, topHigh: [[31, 14], [32, 12], [16, 11]],
      keelHigh: [22, 23, 24, 25, 26, 30, 31, 32, 179, 180, 184, 201, 202, 203, 205, 206, 207, 208, 256, 257, 258, 259, 261, 262, 263, 264, 265],
      laneTop: [63, 1.286, 72], lane60: [0.987, 225], laneEmpty: [], lcms: "2062903736",
    },
    "07L-25R": {
      values: 36615, segments: 7323, passes: 23, valid: 36562, dropout: 18, outside: 35, turning: 0, dropoutPct: 0.049, length: 3600.82, keel: 8473,
      noKeel: [], nPerUnit: [14, 24, 34], keelMpd: 0.8299, keelEtd: 0.8639, fullMpd: 0.7187, fullEtd: 0.7749,
      zones: [[2333, 0.8475, 0.878], [2904, 0.7452, 0.7962], [3236, 0.8931, 0.9145]],
      minUnit: [[7, 0.7473], [151, 0.751], [350, 0.7674]], below: [1, 5, 0], above: [0, 0, 0],
      etd: [0.7473, 7, 0.8287, 1.112, 299], belowUnits: [7, 151, 194, 195, 196, 220],
      classes: { ok: 0, d4: 13, d3: 52, d2: 79, d1: 210, plan: 6, gap: 0, correct: 0, noData: 0 },
      fullRange: [0.701, 0.9109], high: [0, 0], highUnits: 0, topHigh: [],
      keelHigh: [],
      laneTop: [60, 0.93, 312], lane60: [0.93, 312], laneEmpty: [0, 1], lcms: "2061902896",
    },
  };

  for (const rw of ["06-24", "07L-25R"] as const) {
    const d = seeds[rw];
    const e = expected[rw];
    const s = summarizeTexture(d);
    assert.deepEqual([d.qc.n_values, d.qc.n_segments, d.passes.length], [e.values, e.segments, e.passes], rw);
    assert.deepEqual([d.qc.valid, d.qc.dropout, d.qc.outside, d.qc.turning], [e.valid, e.dropout, e.outside, e.turning], rw);
    assert.equal(d.qc.dropout_pct, e.dropoutPct, rw);
    assert.equal(d.axis.length_m, e.length, rw);
    assert.equal(d.runway_keel.n, e.keel, rw);
    assert.deepEqual(d.coverage.no_keel, e.noKeel, rw);

    const ns = d.units.filter((u) => u.keel.n > 0).map((u) => u.keel.n).sort((a, b) => a - b);
    assert.deepEqual([ns[0], ns[ns.length >> 1], ns[ns.length - 1]], e.nPerUnit, rw);

    near(d.runway_keel.mpd_mm, e.keelMpd, `${rw} keel MPD`);
    near(d.runway_keel.etd_mm, e.keelEtd, `${rw} keel ETD`);
    near(d.runway_full.mpd_mm, e.fullMpd, `${rw} full MPD`);
    near(d.runway_full.etd_mm, e.fullEtd, `${rw} full ETD`);

    d.zones.forEach((z, i) => {
      assert.equal(z.n_keel, e.zones[i][0], `${rw} zona ${i + 1} n`);
      near(z.mpd_mm, e.zones[i][1], `${rw} zona ${i + 1} MPD`);
      near(z.etd_mm, e.zones[i][2], `${rw} zona ${i + 1} ETD`);
      assert.equal(faaLevel(z.etd_mm), "measure", `${rw} zona ${i + 1} FAA`);
      assert.equal(z.min_unit, e.minUnit[i][0], `${rw} zona ${i + 1} unit terendah`);
      near(z.min_unit_etd_mm, e.minUnit[i][1], `${rw} zona ${i + 1} ETD terendah`);
      assert.equal(z.n_units_below_0_76, e.below[i], `${rw} zona ${i + 1} < 0,76`);
      assert.equal(z.n_units_at_or_above_1_14, e.above[i], `${rw} zona ${i + 1} ≥ 1,14`);
    });

    near(s.lowest?.keel.etd_mm, e.etd[0], `${rw} ETD min`);
    assert.equal(s.lowest?.unit, e.etd[1], rw);
    near(s.medianEtd, e.etd[2], `${rw} ETD median`);
    near(s.highest?.keel.etd_mm, e.etd[3], `${rw} ETD maks`);
    assert.equal(s.highest?.unit, e.etd[4], rw);
    assert.deepEqual(s.belowPlanning, e.belowUnits, rw);
    assert.equal(s.zonesBelowMeasure, 3, rw);
    assert.equal(s.worstLevel, "measure", rw);
    assert.deepEqual(s.classCounts, e.classes, rw);

    const fullEtd = d.units.flatMap((u) => (u.full.etd_mm === null ? [] : [u.full.etd_mm]));
    near(Math.min(...fullEtd), e.fullRange[0], `${rw} ETD penuh min`);
    near(Math.max(...fullEtd), e.fullRange[1], `${rw} ETD penuh maks`);

    assert.deepEqual([d.qc.n_high, d.qc.n_high_keel], e.high, rw);
    assert.equal(sum(d.units.map((u) => u.high_values.length)), e.high[0], `${rw} semua nilai > 2 mm ada di unit`);
    const withHigh = d.units.filter((u) => u.high_values.length > 0);
    assert.equal(withHigh.length, e.highUnits, rw);
    const top = [...withHigh].sort((a, b) => b.high_values.length - a.high_values.length).slice(0, 3).map((u) => [u.unit, u.high_values.length]);
    assert.deepEqual(top, e.topHigh, rw);
    assert.deepEqual(units(rw, hasHighKeel), e.keelHigh, rw);

    const { all } = d.lanes;
    const iTop = all.mpd_mm.indexOf(Math.max(...all.mpd_mm.filter((v): v is number => v !== null)));
    assert.deepEqual([iTop, all.mpd_mm[iTop], all.n[iTop]], e.laneTop, `${rw} lajur tertinggi`);
    assert.deepEqual([all.mpd_mm[60], all.n[60]], e.lane60, `${rw} lajur 60`);
    assert.deepEqual(all.n.flatMap((n, i) => (n === 0 ? [i] : [])), e.laneEmpty, `${rw} lajur kosong`);
    assert.equal(d.survey.lcms_survey_id, e.lcms, rw);
  }
});

test("D. contoh unit §10.3", () => {
  const cases = [
    { rw: "06-24", unit: 14, keel: [22, 0.6082, 0.2458, 0.6865], full: [113, 0.9651, 0.9721], passes: [[1, 5], [2, 5], [3, 5], [4, 2], [5, 3], [7, 2]], high: 7, highKeel: 0 },
    { rw: "06-24", unit: 32, keel: [22, 1.95, 0.4191, 1.76], full: [114, 1.3077, 1.2462], passes: [[1, 5], [2, 4], [3, 5], [4, 2], [5, 2], [7, 2], [23, 2]], high: 12, highKeel: 10 },
    { rw: "07L-25R", unit: 7, keel: [17, 0.6841, 0.1478, 0.7473], full: [79, 0.6656, 0.7325], passes: [[1, 5], [2, 5], [4, 2], [5, 5]], high: 0, highKeel: 0 },
  ] as const;
  for (const c of cases) {
    const u = seeds[c.rw].units[c.unit - 1];
    const what = `${c.rw} unit ${c.unit}`;
    assert.equal(u.keel.n, c.keel[0], what);
    near(u.keel.mpd_mm, c.keel[1], `${what} MPD`);
    near(u.keel.sd_mm, c.keel[2], `${what} SD`);
    near(u.keel.etd_mm, c.keel[3], `${what} ETD`);
    assert.equal(u.full.n, c.full[0], what);
    near(u.full.mpd_mm, c.full[1], `${what} MPD penuh`);
    near(u.full.etd_mm, c.full[2], `${what} ETD penuh`);
    assert.deepEqual(u.passes.map((p) => [p.pass, p.n_keel]), c.passes, what);
    assert.equal(u.high_values.length, c.high, what);
    assert.equal(u.high_values.filter((v) => v.keel).length, c.highKeel, what);
  }
  const u1 = seeds["06-24"].units[0];
  assert.deepEqual(u1.keel, { n: 0, mpd_mm: null, sd_mm: null, etd_mm: null });
  assert.equal(u1.full.n, 2);
  near(u1.full.mpd_mm, 0.98, "unit 1 MPD penuh");
  near(u1.full.etd_mm, 0.984, "unit 1 ETD penuh");
  assert.equal(seeds["07L-25R"].zones[2].etd_mm.toFixed(3), "0.914", "zona 3 tampil 0.914, bukan 0.915");
  assert.equal(seeds["06-24"].units[13].keel.etd_mm?.toFixed(3), "0.687");
  assert.equal(seeds["06-24"].runway_keel.etd_mm.toFixed(3), "1.006");
});

test("F. lajur: 120 per set; label zona; penomoran unit", () => {
  for (const rw of ["06-24", "07L-25R"] as const) {
    const d = seeds[rw];
    for (const set of [d.lanes.all, d.lanes.zone1, d.lanes.zone2, d.lanes.zone3]) {
      assert.equal(set.n.length, 120);
      assert.ok(set.n.every((n, i) => (n === 0) === (set.mpd_mm[i] === null)), "mpd null tepat bila n = 0");
    }
    assert.ok(d.units.every((u, i) => u.unit === i + 1));
    assert.equal(d.passes.length, 23);
    assert.ok(d.passes.every((p, i) => i === 0 || d.passes[i - 1].pass < p.pass), "pass naik");
  }
  assert.deepEqual(seeds["06-24"].zones.map((z) => z.label), ["06 end", "Middle", "24 end"]);
  assert.deepEqual(seeds["07L-25R"].zones.map((z) => z.label), ["07L end", "Middle", "25R end"]);
  assert.deepEqual(seeds["07L-25R"].zones.map((z) => z.units), [[1, 120], [121, 240], [241, 360]]);
});

test("H. k_flags seed", () => {
  const count = (rw: RunwayId, k: "minimum" | "planning") => {
    const of = (v: boolean | null) => seeds[rw].units.filter((u) => u.k_flags[k] === v).length;
    return [of(true), of(false), of(null)];
  };
  assert.deepEqual(count("06-24", "minimum"), [0, 297, 3]);
  assert.deepEqual(count("06-24", "planning"), [14, 283, 3]);
  assert.deepEqual(count("07L-25R", "minimum"), [0, 360, 0]);
  assert.deepEqual(count("07L-25R", "planning"), [6, 354, 0]);
});
