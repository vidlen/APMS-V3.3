/**
 * bbi-surveys.test.ts — manifest survei BBI (brief §10.2 uji I). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BbiSurveyEntry } from "./data-overrides.ts";
import { listBbiSurveys } from "./bbi-surveys.ts";

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
