/**
 * bbi-surveys.test.ts — manifest survei BBI dan aturan pathname upload (brief §10.2 uji I, K). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bbiUploadRule } from "../../api/bbi-files.ts";
import type { BbiSurveyEntry } from "./data-overrides.ts";
import { listBbiSurveys } from "./bbi-surveys.ts";

test("K. bbiUploadRule menerima hanya pathname BBI yang sah", () => {
  const ok = [
    ["apms/production/bbi/2026-07/units-06-24-0123456789ab.json", "application/json"],
    ["apms/production/bbi/2026-07/trace-07L-25R-0123456789ab.json", "application/json"],
    ["apms/production/bbi/2026-07/raw/0123456789ab-bbi_per_unit_web.csv", "text/csv"],
  ] as const;
  for (const [p, type] of ok) {
    const rule = bbiUploadRule(p, "production");
    assert.equal(rule?.contentType, type, p);
    assert.equal(rule?.maxBytes, 5 * 1024 * 1024, p);
  }
  const bad = [
    "apms/production/overrides.json",
    "apms/production/bbi/2026-07/../units-06-24-0123456789ab.json",
    "apms/production/bbi/../../overrides.json",
    "apms/preview/bbi/2026-07/units-06-24-0123456789ab.json", // env lain
    "apms/production/bbi/2026-07/units-06-24-0123456789a.json", // hash 11
    "apms/production/bbi/2026-07/units-06-24-0123456789AB.json", // bukan hex huruf kecil
    "apms/production/bbi/2026-07/units-05-23-0123456789ab.json", // runway lain
    "apms/production/skid/2026-07/units-06-24-0123456789ab.json", // folder skid
    "apms/production/bbi/2026-07/units-06-24-0123456789ab.csv", // ekstensi lain
    "apms/production/bbi/2026-07/raw/0123456789ab-x.json",
    "apms/production/bbi/2026-07/raw/0123456789ab-a b.csv", // spasi
    "apms/production/bbi/2026-07/raw/0123456789ab-.csv/../x.csv",
  ];
  for (const p of bad) assert.equal(bbiUploadRule(p, "production"), null, p);
});

const entry = (id: string, label: string, rw: "06-24" | "07L-25R", date: string): BbiSurveyEntry => ({
  id,
  label,
  runways: { [rw]: { unitsUrl: `https://blob/${id}-${rw}-u.json`, traceUrl: `https://blob/${id}-${rw}-t.json`, rawCsv: [], date, lines: ["P01_L"], importedAt: "2026-11-03T00:00:00Z" } },
});

test("I. survei: seed saja, id 2026-06 menggantikan runway seed, yang lebih baru di depan", () => {
  const seedOnly = listBbiSurveys();
  assert.deepEqual(seedOnly.map((s) => s.id), ["2026-06"]);
  assert.deepEqual(Object.keys(seedOnly[0].runways), ["06-24"], "seed hanya 06/24");
  assert.equal(seedOnly[0].runways["06-24"]?.unitsUrl, "/data/bbi-06-24-2026.json");
  assert.equal(seedOnly[0].runways["06-24"]?.traceUrl, "/data/bbi-06-24-2026-trace.json");
  assert.equal(seedOnly[0].runways["06-24"]?.source, "seed");

  const replaced = listBbiSurveys({ "2026-06": entry("2026-06", "Jun 2026", "06-24", "2026-06-29") });
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].runways["06-24"]?.source, "admin");
  assert.equal(replaced[0].runways["06-24"]?.unitsUrl, "https://blob/2026-06-06-24-u.json");

  const added = listBbiSurveys({ "2026-06": entry("2026-06", "Jun 2026", "07L-25R", "2026-06-30") });
  assert.equal(added[0].runways["06-24"]?.source, "seed", "runway lain pada id yang sama tetap seed");
  assert.equal(added[0].runways["07L-25R"]?.source, "admin");

  const newer = listBbiSurveys({ "2027-06": entry("2027-06", "Jun 2027", "06-24", "2027-06-05") });
  assert.deepEqual(newer.map((s) => s.id), ["2027-06", "2026-06"], "terbaru dulu");
  assert.deepEqual(Object.keys(newer[0].runways), ["06-24"]);
});
