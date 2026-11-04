/**
 * texture.test.ts — kelas tampilan, kontras warna, dan helper tab Macrotexture (brief tekstur §10.2 uji E, M). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TEXTURE_CLASSES, TEXTURE_CLASS_META, classifyTexture, etdFromMpd, faaLevel } from "../config/texture.ts";
import { unitRanges } from "./texture.ts";

test("E. kelas dan tingkat FAA di batas (batas bawah inklusif)", () => {
  const cases: [number | null, string][] = [
    [1.14, "ok"], [1.1399, "d4"], [1.05, "d4"], [1.0499, "d3"], [0.95, "d3"], [0.9499, "d2"], [0.85, "d2"], [0.8499, "d1"], [0.76, "d1"],
    [0.7599, "plan"], [0.4, "plan"], [0.3999, "gap"], [0.25, "gap"], [0.2499, "correct"], [null, "noData"],
  ];
  for (const [etd, cls] of cases) assert.equal(classifyTexture(etd), cls, String(etd));

  const levels: [number, string][] = [[1.14, "ok"], [1.1399, "measure"], [0.76, "measure"], [0.7599, "plan"], [0.4, "plan"], [0.3999, "gap"], [0.25, "gap"], [0.2499, "correct"]];
  for (const [etd, level] of levels) assert.equal(faaLevel(etd), level, String(etd));

  assert.ok(Math.abs(etdFromMpd(1) - 1) < 1e-12);
  assert.ok(Math.abs(etdFromMpd(0.6082) - 0.68656) < 1e-9);
});

// WCAG relative luminance dari warna #RRGGBB.
function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

test("M. kontras teks kelas minimal 4,5:1 (noData memakai warna teks tema)", () => {
  for (const c of TEXTURE_CLASSES) {
    const { color, text } = TEXTURE_CLASS_META[c];
    if (c === "noData") continue;
    const [a, b] = [luminance(color), luminance(text)].sort((p, q) => q - p);
    const ratio = (a + 0.05) / (b + 0.05);
    assert.ok(ratio >= 4.5, `${c}: ${ratio.toFixed(2)}:1`);
  }
});

test("unitRanges", () => {
  assert.deepEqual(unitRanges([1, 299, 300]), ["1", "299–300"]);
  assert.deepEqual(unitRanges([5, 6, 11, 12, 13]), ["5–6", "11–13"]);
  assert.deepEqual(unitRanges([]), []);
});
