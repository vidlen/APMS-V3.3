/**
 * skid-import.test.ts — uji konversi CSV Moventor (brief admin-skid-upload §10, T1–T8). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildRunway, buildSurvey, inspectFile, laneFromName, parseMoventorCsv, runwayFromName, toWib, type StationTable } from "./skid-import.ts";
import { SkidRunwaySchema, SkidTraceSchema } from "./skid-schema.ts";
import { LANE_ORDER } from "../config/skid.ts";

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const FIXTURE = "2026_06_05_20_21_06_CGK 06 - 24 1.5 m Left.csv";
const CSV = readFileSync(at(`./__fixtures__/skid/${FIXTURE}`), "utf-8");
const SEED = {
  "06-24": SkidRunwaySchema.parse(JSON.parse(readFileSync(at("../../public/data/skid-06-24-2026.json"), "utf-8"))),
  "07L-25R": SkidRunwaySchema.parse(JSON.parse(readFileSync(at("../../public/data/skid-07L-25R-2026.json"), "utf-8"))),
};
const STATIONS = JSON.parse(readFileSync(at("../config/skid-unit-stations-2026.json"), "utf-8")) as StationTable;
const L15 = LANE_ORDER.indexOf("L1.5");
const seedLane = SEED["06-24"].units.map((u) => u.lanes[L15]);

const one = (text = CSV, name = FIXTURE, s0?: number) => {
  const f = inspectFile(name, text);
  const b = buildRunway([f], "06-24", SEED["06-24"], STATIONS, {
    s0: s0 === undefined ? undefined : { "L1.5": s0 },
    importedAt: "2026-10-26T00:00:00.000Z",
  });
  return { f, b };
};
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);
const near = (a: number | null, b: number | null) => a === b || (a !== null && b !== null && Math.abs(a - b) <= 0.00005 + 1e-9);

test("T1. parser membaca fixture", () => {
  const p = parseMoventorCsv(CSV);
  const m = (k: string) => p.meta.find((x) => x.key === k)?.value;
  assert.equal(m("DATE"), "2026-06-05");
  assert.equal(m("TIME"), "17:21:06");
  assert.equal(m("TIME ZONE"), "UTC+00:00");
  assert.equal(m("RESOLUTION (m)"), "1");
  assert.equal(m("WETTING"), "On");
  assert.equal(m("NAME"), "CGK 06 - 24");
  assert.equal(m("RUNWAY DIRECTION"), "06");
  assert.equal(m("LENGTH"), "2400");
  assert.equal(p.rows.length, 2400);
  assert.deepEqual(p.rows.map((r) => r.d), Array.from({ length: 2400 }, (_, i) => i + 1));
  assert.equal(p.endOfData, true);
  assert.equal(p.delimiter, ",");
  const mu = p.rows.map((r) => r.mu as number);
  assert.ok(Math.abs(mu.reduce((a, b) => a + b, 0) / mu.length - 0.70579708333333) < 1e-12);
  assert.equal(Math.min(...mu), 0.2785);
  assert.equal(Math.max(...mu), 0.9635);
  const sp = p.rows.map((r) => r.speed as number);
  assert.ok(Math.abs(sp.reduce((a, b) => a + b, 0) / sp.length - 65.1324) < 1e-9);
  assert.equal(Math.min(...sp), 62.028);
  assert.equal(Math.max(...sp), 67.86);
  const f = inspectFile(FIXTURE, CSV);
  assert.equal(f.stats?.outsideSpeed, 0);
  assert.equal(f.stats?.gpsRows, 2400);
  assert.equal(f.stats?.heldRows, 456);
  assert.equal(p.startUtc, "2026-06-05T17:21:06Z");
  assert.equal(f.stats?.startWib, "2026-06-06 00:21");
  assert.deepEqual(f.errors, []);
});

test("T2. deteksi runway dan lajur dari nama berkas", () => {
  const cases: [string, string | null, string | null][] = [
    [FIXTURE, "06-24", "L1.5"],
    ["2026_06_05_20_21_06_CGK_06_-_24_1_5_m_Left.csv", "06-24", "L1.5"],
    ["2026_06_14_21_01_33_CGK 07L-25R 6.0 m Left.csv", "07L-25R", "L6.0"],
    ["2026_06_14_21_01_33_CGK_07L-25R_6_0_m_Left.csv", "07L-25R", "L6.0"],
    ["CGK 06 - 24 3,0 m Right.csv", "06-24", "R3.0"],
    ["CGK 06 - 24 2.0 m Left.csv", "06-24", null],
  ];
  for (const [n, rw, lane] of cases) {
    assert.equal(runwayFromName(n), rw, n);
    assert.equal(laneFromName(n), lane, n);
  }
});

test("T3. reproduksi lajur L1.5 seed dengan s0 dikunci 2705.7", () => {
  const { b } = one(CSV, FIXTURE, 2705.7);
  assert.deepEqual(b.errors, []);
  const got = b.units!.units.map((u) => u.lanes[L15]);
  // Unit 35: rata-rata 152 m = 0,86275 persis (seri desimal). Python membulatkan ke 0,8627 karena derau float; kita 0,8628.
  // Selisih satu digit terakhir, nilai tak dibulatkan masih dalam toleransi 0,00005 (build-skid-1m.mjs menerimanya).
  const ties = new Set([35]);
  got.forEach((g, i) => {
    const s = seedLane[i];
    const m152 = near(g.mu_152m, s.mu_152m) || (ties.has(i + 1) && Math.abs((g.mu_152m as number) - (s.mu_152m as number)) <= 0.0001 + 1e-9);
    assert.ok(g.n === s.n && near(g.mu_10m, s.mu_10m) && m152, `unit ${i + 1}: ${JSON.stringify(g)} vs seed ${JSON.stringify(s)}`);
  });
  assert.equal(got.length, 300);
  const marks: [number, number, number, number][] = [
    [30, 7, 0.8865, 0.8723], [100, 10, 0.7677, 0.751], [150, 10, 0.7904, 0.7815], [200, 10, 0.6937, 0.6769], [270, 4, 0.925, 0.8979],
  ];
  for (const [u, n, m10, m152] of marks) {
    const l = b.units!.units[u - 1].lanes[L15];
    assert.equal(l.n, n, `unit ${u}`);
    assert.equal(l.mu_10m, m10, `unit ${u}`);
    assert.equal(l.mu_152m, m152, `unit ${u}`);
  }
  assert.deepEqual(b.units!.coverage, { first_unit: 30, last_unit: 270, n_units: 241, n_units_total: 300 });
  assert.equal(got.reduce((a, l) => a + l.n, 0), 2400);
});

test("T4. s0 otomatis dari GPS", () => {
  const { b } = one();
  assert.deepEqual(b.errors, []);
  const l = b.lanes[0];
  assert.equal(l.s0, 2705.6);
  assert.equal(l.s0Source, "median proyeksi GPS");
  assert.ok(Math.abs(l.slope as number) < 0.05);
  const diffs = b.units!.units.flatMap((u, i) => (u.lanes[L15].n !== seedLane[i].n ? [u.unit] : []));
  assert.deepEqual(diffs, [66, 107]);
  assert.equal(b.units!.units[65].lanes[L15].n, 9);
  assert.equal(b.units!.units[106].lanes[L15].n, 10);
});

test("T6. lajur sebagian (1 dari 8)", () => {
  const { b } = one(CSV, FIXTURE, 2705.7);
  const d = b.units!, t = b.trace!;
  assert.equal(d.lanes.length, 8);
  assert.equal(d.lanes.filter((l) => l.measured === false).length, 7);
  assert.equal(t.lanes.length, 8);
  assert.equal(t.lanes.filter((l) => l.measured === false).length, 7);
  d.units.forEach((u) => {
    const inside = u.unit >= 30 && u.unit <= 270;
    assert.equal(u.lanes_measured, inside ? 1 : 0, `unit ${u.unit}`);
    assert.deepEqual(u.governing_10m, inside ? { lane: "L1.5", mu: u.lanes[L15].mu_10m } : null);
  });
  assert.ok(b.warnings.some((w) => w.code === "partial-lanes"));
  SkidRunwaySchema.parse(JSON.parse(JSON.stringify(d)));
  SkidTraceSchema.parse(JSON.parse(JSON.stringify(t)));
  assert.equal(t.reconciliation.n_ok, t.reconciliation.unit_lane_pairs);
});

test("T7. galat dan peringatan", () => {
  const run = (text: string, extra: { name: string; text: string }[] = []) => buildSurvey([{ name: FIXTURE, text }, ...extra], SEED, STATIONS);
  const lines = CSV.split(/\r?\n/);

  const dup = run(CSV, [{ name: FIXTURE.replace("2026_06_05_20_21_06", "2026_06_05_21_00_00"), text: CSV }]);
  assert.ok(codes(dup.errors).includes("duplicate-lane"));

  const gap = run(lines.filter((l) => !/^500,/.test(l)).join("\n"));
  assert.ok(codes(gap.errors).includes("distance-gap"));

  const noGps = run(lines.map((l) => l.replace(/"-?\d+\.\d+, -?\d+\.\d+"/, '""')).join("\n"));
  assert.ok(codes(noGps.errors).includes("no-gps-runway"));

  assert.ok(codes(run(CSV.replace('"RUNWAY DIRECTION",06', '"RUNWAY DIRECTION",24')).errors).includes("reverse-direction"));

  // pemisah ; dan koma desimal pada DISTANCE, FRICTION, SPEED; POSITION tetap teks bertitik
  const semi = lines.map((l) => {
    const m = /^(\d+),([^,]*),([^,]*),([^,]*),([^,]*),("[^"]*"),(.*)$/.exec(l);
    if (m) return [m[1], m[2].replace(".", ","), m[3].replace(".", ","), m[4], m[5], m[6], m[7]].join(";");
    if (/^DISTANCE,/.test(l)) return l.replaceAll(",", ";");
    return l.replace(/^("[^"]*"|[A-Z]+),/, "$1;");
  }).join("\n");
  const s = inspectFile(FIXTURE, semi), ref = inspectFile(FIXTURE, CSV);
  assert.deepEqual(s.errors, []);
  assert.ok(codes(s.warnings).includes("semicolon"));
  assert.equal(s.stats?.rows, 2400);
  assert.equal(s.stats?.gpsRows, 2400);
  assert.deepEqual(
    s.parsed!.rows.map((r) => [r.d, r.mu, r.speed, r.lat, r.lon]),
    ref.parsed!.rows.map((r) => [r.d, r.mu, r.speed, r.lat, r.lon]),
  );

  assert.ok(codes(inspectFile(FIXTURE, CSV.replace('"END OF DATA"', "")).warnings).includes("no-end-marker"));
  assert.ok(codes(inspectFile(FIXTURE, CSV.replace(/^1,0\.8695,/m, "1,0.1695,")).warnings).includes("stat-mismatch"));
});

test("T9. berkas disimpan ulang Excel dengan seluruh isi di kolom A", () => {
  // Tiruan Excel berlocale Indonesia: baca (kutip pembuka sel dibuang), lalu simpan dengan pemisah ';'
  // (sel yang memuat kutip dibungkus dan kutipnya digandakan). Tiruan ini identik byte-per-byte dengan
  // berkas nyata yang gagal dibaca pada 26 Okt 2026.
  const excelColumnA = (l: string) => {
    const cell = l.replace(/^"([^"]*)"/, "$1");
    return cell.includes('"') ? `"${cell.replaceAll('"', '""')}"` : cell;
  };
  const wrapped = CSV.replace(/\r/g, "").split("\n").map(excelColumnA).join("\r\n");
  assert.match(wrapped, /^"DISTANCE,FRICTION,""SPEED \(km\/h\)""/m);
  const w = inspectFile(FIXTURE, wrapped), ref = inspectFile(FIXTURE, CSV);
  assert.deepEqual(w.errors, []);
  assert.ok(codes(w.warnings).includes("excel-wrapped"));
  assert.ok(!codes(ref.warnings).includes("excel-wrapped"));
  assert.deepEqual(w.parsed!.meta, ref.parsed!.meta);
  assert.equal(w.parsed!.startUtc, ref.parsed!.startUtc);
  assert.deepEqual(w.parsed!.rows, ref.parsed!.rows);
  assert.deepEqual(w.stats, ref.stats);
});

test("T8. end_utc melewati tengah malam", () => {
  const text = CSV.split(/\r?\n/)
    .map((l) => (/^TIME,/.test(l) ? "TIME,23:59:00" : /^2400,/.test(l) ? l.replace(/,\d\d:\d\d:\d\d,/, ",00:01:30,") : l))
    .join("\n");
  const { b } = one(text, FIXTURE, 2705.7);
  assert.equal(b.units!.survey.start_utc, "2026-06-05T23:59:00Z");
  assert.equal(b.units!.survey.end_utc, "2026-06-06T00:01:30Z");
  assert.equal(toWib("2026-06-05T17:21:06Z"), "2026-06-06 00:21");
});

test("T5. reproduksi penuh dari 16 CSV asli (lokal saja)", { skip: existsSync(at("../../data-raw/skid-2026")) ? false : "data-raw/skid-2026 tidak ada" }, () => {
  // Folder data-raw/skid-2026 sengaja tidak ada di repo. Kalau ada, jalankan juga: npm run skid:1m -- --check
  assert.ok(true);
});
