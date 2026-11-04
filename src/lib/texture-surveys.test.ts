/**
 * texture-surveys.test.ts — manifest survei tekstur dan aturan pathname upload (brief tekstur §10.2 uji I, K). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { textureUploadRule } from "../../api/texture-files.ts";
import type { TextureSurveyEntry } from "./data-overrides.ts";
import { listTextureSurveys } from "./texture-surveys.ts";

test("K. textureUploadRule menerima hanya pathname tekstur yang sah", () => {
  const ok = [
    ["apms/production/texture/2026-07/units-06-24-0123456789ab.json", "application/json"],
    ["apms/production/texture/2026-07/units-07L-25R-0123456789ab.json", "application/json"],
    ["apms/production/texture/2026-07/raw/0123456789ab-cek_per_unit_0624.csv", "text/csv"],
  ] as const;
  for (const [p, type] of ok) {
    const rule = textureUploadRule(p, "production");
    assert.equal(rule?.contentType, type, p);
    assert.equal(rule?.maxBytes, 5 * 1024 * 1024, p);
  }
  const bad = [
    "apms/production/overrides.json",
    "apms/production/texture/2026-07/../units-06-24-0123456789ab.json",
    "apms/production/texture/../../overrides.json",
    "apms/preview/texture/2026-07/units-06-24-0123456789ab.json", // env lain
    "apms/production/texture/2026-07/units-06-24-0123456789a.json", // hash 11
    "apms/production/texture/2026-07/units-06-24-0123456789AB.json", // bukan hex huruf kecil
    "apms/production/texture/2026-07/units-05-23-0123456789ab.json", // runway lain
    "apms/production/texture/2026-07/trace-06-24-0123456789ab.json", // tekstur tidak punya trace
    "apms/production/bbi/2026-07/units-06-24-0123456789ab.json", // folder bbi
    "apms/production/texture/2026-07/units-06-24-0123456789ab.csv", // ekstensi lain
    "apms/production/texture/2026-07/raw/0123456789ab-x.json",
    "apms/production/texture/2026-07/raw/0123456789ab-a b.csv", // spasi
    "apms/production/texture/2026-07/raw/0123456789ab-.csv/../x.csv",
  ];
  for (const p of bad) assert.equal(textureUploadRule(p, "production"), null, p);
});

const entry = (id: string, label: string, rw: "06-24" | "07L-25R", date: string): TextureSurveyEntry => ({
  id,
  label,
  runways: { [rw]: { url: `https://blob/${id}-${rw}.json`, rawCsv: [], date, lcmsSurveyId: null, importedAt: "2026-11-04T00:00:00Z" } },
});

test("I. survei: seed dua runway, id 2026-06 menggantikan runway seed itu saja, yang lebih baru di depan", () => {
  const seedOnly = listTextureSurveys();
  assert.deepEqual(seedOnly.map((s) => s.id), ["2026-06"]);
  assert.deepEqual(Object.keys(seedOnly[0].runways), ["06-24", "07L-25R"]);
  assert.deepEqual(seedOnly[0].runways["06-24"], { url: "/data/texture-06-24-2026.json", date: "2026-06-28", source: "seed" });
  assert.deepEqual(seedOnly[0].runways["07L-25R"], { url: "/data/texture-07L-25R-2026.json", date: "2026-06-18", source: "seed" });

  const replaced = listTextureSurveys({ "2026-06": entry("2026-06", "Jun 2026", "06-24", "2026-06-29") });
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].runways["06-24"]?.source, "admin");
  assert.equal(replaced[0].runways["06-24"]?.url, "https://blob/2026-06-06-24.json");
  assert.equal(replaced[0].runways["07L-25R"]?.source, "seed", "runway lain pada id yang sama tetap seed");

  const newer = listTextureSurveys({ "2027-06": entry("2027-06", "Jun 2027", "07L-25R", "2027-06-05") });
  assert.deepEqual(newer.map((s) => s.id), ["2027-06", "2026-06"], "terbaru dulu");
  assert.deepEqual(Object.keys(newer[0].runways), ["07L-25R"]);

  const older = listTextureSurveys({ "2025-06": entry("2025-06", "Jun 2025", "06-24", "2025-06-05") });
  assert.deepEqual(older.map((s) => s.id), ["2026-06", "2025-06"]);
});
