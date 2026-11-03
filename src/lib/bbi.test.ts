/**
 * bbi.test.ts — helper tab Roughness (brief §10.2 uji H, ditambah decimateMax dan baris profil). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BBI_CLASSES, BBI_CLASS_META, classifyBbi } from "../config/bbi.ts";
import { decimateMax, profileRows, traceX, unitAtX, unitRanges } from "./bbi.ts";
import type { BbiLineTrace } from "../types/bbi.ts";

test("H. kelas tampilan di batas", () => {
  assert.equal(classifyBbi(0.1999, "Acceptable"), "b0");
  assert.equal(classifyBbi(0.2, "Acceptable"), "b1");
  assert.equal(classifyBbi(0.4, "Acceptable"), "b2");
  assert.equal(classifyBbi(0.6, "Acceptable"), "b3");
  assert.equal(classifyBbi(0.8, "Acceptable"), "b4");
  assert.equal(classifyBbi(1.0, "Acceptable"), "b4");
  assert.equal(classifyBbi(1.0001, "Excessive"), "excessive");
  assert.equal(classifyBbi(1.3, "Unacceptable"), "unacceptable");
  assert.equal(classifyBbi(null, null), "noData");
});

// WCAG relative luminance dari warna #RRGGBB.
function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

test("kontras teks kelas minimal 4,5:1 (noData memakai warna teks tema)", () => {
  for (const c of BBI_CLASSES) {
    const { color, text } = BBI_CLASS_META[c];
    if (c === "noData") continue;
    const [a, b] = [luminance(color), luminance(text)].sort((p, q) => q - p);
    const ratio = (a + 0.05) / (b + 0.05);
    assert.ok(ratio >= 4.5, `${c}: ${ratio.toFixed(2)}:1`);
  }
});

const line: BbiLineTrace = {
  line: "P01_L",
  n: 12,
  x0_from_06_m: 10,
  dx_m: 0.25,
  bbi: [0, 0.1, 0.9, 0.2, 0.3, 0.1, 1.2, 0.2, 0.2, 0.4, 0.1, 0],
  unit_runs: [[1, 0, 5], [2, 6, 11]],
  flagged: [{ i: 6, zone: "Excessive" }],
  null_zone_i: [0, 11],
  start_of_run_last_i: 3,
};

test("traceX, unitAtX: posisi dan unit dari unit_runs, null di luar jangkauan", () => {
  assert.equal(traceX(line, 4), 11);
  assert.equal(unitAtX(line, 10), 1);
  assert.equal(unitAtX(line, 11.5), 2);
  assert.equal(unitAtX(line, 5), null);
  assert.equal(unitAtX(line, 13), null);
  const west = { ...line, x0_from_06_m: 12.75, dx_m: -0.25 };
  assert.equal(unitAtX(west, 12.75), 1, "lintasan W: indeks 0 di x terbesar");
  assert.equal(unitAtX(west, 10), 2);
});

test("decimateMax: puncak tiap bin 1 m tidak hilang", () => {
  assert.deepEqual(decimateMax(line, [0, 100]), [
    { x: 10.5, bbi: 0.9 },
    { x: 11.5, bbi: 1.2 },
    { x: 12.5, bbi: 0.4 },
  ]);
  assert.deepEqual(decimateMax(line, [11, 11.9]), [{ x: 11.5, bbi: 1.2 }]);
});

test("profileRows: jendela sempit titik asli, jendela lebar per bin, titik flagged selalu ada", () => {
  const raw = profileRows([line], [0, 100]);
  const atPeak = raw.find((r) => r.x === 11.5);
  assert.equal(atPeak?.[line.line], 1.2);
  assert.equal(atPeak?.[`f_${line.line}`], 1.2);
  assert.equal(raw.filter((r) => r[line.line] !== undefined).length, 12, "12 titik apa adanya");
  assert.ok(raw.some((r) => r.x === 50.5 && r[line.line] === undefined), "bagian tanpa data punya baris kosong untuk tooltip");

  const wide = profileRows([line], [0, 700]);
  assert.equal(wide.filter((r) => r[line.line] !== undefined).length, 3, "3 bin 1 m");
  assert.equal(wide.find((r) => r[`f_${line.line}`] !== undefined)?.x, 11.5);

  // Titik flagged di luar tengah bin: baris sendiri dengan x asli, garisnya memakai nilai bin.
  const offCentre = profileRows([{ ...line, flagged: [{ i: 4, zone: "Excessive" }] }], [0, 700]);
  const flaggedRow = offCentre.find((r) => r[`f_${line.line}`] !== undefined);
  assert.equal(flaggedRow?.x, 11);
  assert.equal(flaggedRow?.[`f_${line.line}`], 0.3);
  assert.equal(flaggedRow?.[line.line], 1.2);

  const other = { ...line, line: "P02_L", x0_from_06_m: 10.01, flagged: [] };
  const merged = profileRows([line, other], [0, 100]);
  const row = merged.find((r) => r.x === 11.5);
  assert.equal(row?.["P01_L"], 1.2);
  assert.equal(row?.["P02_L"], 1.2, "dua garis di satu kisi 0,25 m");
});

test("unitRanges", () => {
  assert.deepEqual(unitRanges([1, 2, 3, 298, 299, 300]), ["1–3", "298–300"]);
  assert.deepEqual(unitRanges([5]), ["5"]);
  assert.deepEqual(unitRanges([]), []);
});
