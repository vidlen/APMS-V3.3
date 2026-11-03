/**
 * bbi-import.test.ts — modul konversi BBI (brief §10.2 uji A, C fixture, G). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BbiRunwaySchema, BbiTraceSchema } from "./bbi-schema.ts";
import { bbiSurvey, buildBbi, detectRole, parseDecimal, type BbiInputFile, type Issue } from "./bbi-import.ts";

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
