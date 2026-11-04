/**
 * texture-surveys.test.ts — manifest survei tekstur (brief tekstur §10.2 uji I). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { TextureSurveyEntry } from "./data-overrides.ts";
import { listTextureSurveys } from "./texture-surveys.ts";

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
