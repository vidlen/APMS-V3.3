/**
 * texture-import.test.ts — modul konversi tekstur (brief tekstur §10.2 uji A, C, F, G). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TextureRunwaySchema } from "./texture-schema.ts";
import { buildTexture, detectRole, detectRunway, parseDecimal, textureSurvey, type Issue, type TextureInputFile } from "./texture-import.ts";
import type { RunwayId } from "../types/skid.ts";

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
