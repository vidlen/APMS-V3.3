/**
 * skid-surveys.test.ts — T9 (aturan pathname upload) dan T10 (manifest survei). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { skidUploadRule } from "../../api/skid-files.ts";
import { normalizeOverrides, type SkidSurveyEntry } from "./data-overrides.ts";
import { listSkidSurveys } from "./skid-surveys.ts";

test("T9. skidUploadRule menerima hanya pathname skid yang sah", () => {
  const ok = [
    ["apms/production/skid/2027-06/units-06-24-0123456789ab.json", "application/json"],
    ["apms/production/skid/2027-06/trace-07L-25R-0123456789ab.json", "application/json"],
    ["apms/production/skid/2027-06/raw/0123456789ab-CGK-06---24-1.5-m-Left.csv", "text/csv"],
  ] as const;
  for (const [p, type] of ok) assert.equal(skidUploadRule(p, "production")?.contentType, type, p);
  const bad = [
    "apms/production/overrides.json",
    "apms/production/skid/2027-06/../units-06-24-0123456789ab.json",
    "apms/production/skid/../../overrides.json",
    "apms/preview/skid/2027-06/units-06-24-0123456789ab.json", // env lain
    "apms/production/skid/2027-06/units-06-24-0123456789a.json", // hash 11
    "apms/production/skid/2027-06/units-06-24-0123456789AB.json", // bukan hex huruf kecil
    "apms/production/skid/2027-06/units-06-24-0123456789abc.json", // hash 13
    "apms/production/skid/2027-06/units-05-23-0123456789ab.json", // runway lain
    "apms/production/skid/2027-06/units-06-24-0123456789ab.csv", // ekstensi lain
    "apms/production/skid/2027-06/raw/0123456789ab-x.json",
    "apms/production/skid/2027-06/raw/0123456789ab-a b.csv", // spasi
    "apms/production/skid/2027-06/raw/0123456789ab-.csv/../x.csv",
  ];
  for (const p of bad) assert.equal(skidUploadRule(p, "production"), null, p);
});

const entry = (id: string, label: string, rw: "06-24" | "07L-25R", startWib: string): SkidSurveyEntry => ({
  id, label,
  runways: { [rw]: { unitsUrl: `https://blob/${id}-${rw}-u.json`, traceUrl: `https://blob/${id}-${rw}-t.json`, rawCsv: [], startWib, lanes: ["L1.5"], s0Mode: "gps", importedAt: "2026-10-26T00:00:00Z" } },
});

test("T10. manifest survei: dipertahankan, digabung dengan seed, id 2026-06 hanya menggantikan runway yang sama", () => {
  const skidSurveys = { "2027-06": entry("2027-06", "Jun 2027", "06-24", "2027-06-05 00:21") };
  assert.deepEqual(normalizeOverrides({ skidSurveys }).skidSurveys, skidSurveys);
  assert.equal(normalizeOverrides({}).skidSurveys, undefined);

  const seedOnly = listSkidSurveys();
  assert.deepEqual(seedOnly.map((s) => s.id), ["2026-06"]);
  assert.deepEqual(Object.keys(seedOnly[0].runways).sort(), ["06-24", "07L-25R"]);

  const merged = listSkidSurveys(skidSurveys);
  assert.deepEqual(merged.map((s) => s.id), ["2027-06", "2026-06"]); // terbaru dulu
  assert.deepEqual(Object.keys(merged[0].runways), ["06-24"]);

  const replaced = listSkidSurveys({ "2026-06": entry("2026-06", "Jun 2026", "06-24", "2026-06-06 00:30") });
  assert.equal(replaced.length, 1);
  const s = replaced[0];
  assert.equal(s.runways["06-24"]?.source, "admin");
  assert.equal(s.runways["06-24"]?.unitsUrl, "https://blob/2026-06-06-24-u.json");
  assert.equal(s.runways["07L-25R"]?.source, "seed");
  assert.equal(s.runways["07L-25R"]?.unitsUrl, "/data/skid-07L-25R-2026.json");
});
