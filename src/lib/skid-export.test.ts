/**
 * skid-export.test.ts — CSV profil (N). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LANE_ORDER } from "../config/skid.ts";
import { SkidTraceSchema } from "./skid-schema.ts";
import { movingAverage, xOf } from "./skid-trace.ts";
import { exportName, profileCsv } from "./skid-export.ts";
import type { LaneCode } from "../types/skid.ts";

const read = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/data/${name}`, import.meta.url)), "utf-8"));
const rt = SkidTraceSchema.parse(read("skid-06-24-2026-1m.json"));
const ma = new Map<LaneCode, (number | null)[]>(rt.lanes.map((l) => [l.lane, movingAverage(l.mu).mean]));

test("N. ekspor CSV profil: jumlah baris, kolom, dan nilai sama dengan data per meter", () => {
  const all = profileCsv(rt, LANE_ORDER, [0, rt.unit_bounds.last_end_m], ma).trim().split("\n");
  assert.equal(all[0], "runway,lane,distance_m,x_m,station_m,unit,mu_1m,mu_152m_avg,speed_kmh");
  assert.equal(all.length - 1, 8 * 2400, "seluruh runway, semua lajur");
  assert.ok(all.every((l) => l.split(",").length === 9));

  const l30 = rt.lanes.find((l) => l.lane === "L3.0")!;
  const [x0, x1] = [1000, 1500];
  const rows = profileCsv(rt, ["L3.0"], [x0, x1], ma).trim().split("\n").slice(1).map((l) => l.split(","));
  const expected = l30.mu.map((_, i) => i).filter((i) => xOf(rt, l30, i) >= x0 && xOf(rt, l30, i) <= x1);
  assert.equal(rows.length, expected.length);
  assert.ok(rows.length >= 499 && rows.length <= 502, `sekitar 500 bacaan, dapat ${rows.length}`);
  assert.ok(rows.every((r) => r[0] === "06-24" && r[1] === "L3.0"));
  const i = expected[0];
  assert.deepEqual(rows[0].slice(2, 3), [String(l30.d_first + i)]);
  assert.equal(Number(rows[0][6]), Number((l30.mu[i] as number).toFixed(4)));
  assert.equal(Number(rows[0][8]), l30.speed_kmh[i]);

  assert.equal(exportName("06-24", "L3.0", [1000.2, 1499.6], "csv"), "skid-06-24-L3.0-x1000-1500.csv");
});
