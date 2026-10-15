/**
 * skid-trace.test.ts — uji data per meter dan hitungan grafik (F–M). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LANE_ORDER } from "../config/skid.ts";
import { SkidRunwaySchema, SkidTraceSchema } from "./skid-schema.ts";
import {
  evaluateFaa320, fixedSegments, indexAtX, laneKey, meterRuns, movingAverage, profileRows, stationOf, thirds,
  unitAtStation, unitMeanFromTrace, unitWindowMean, unitXRange, xOf,
} from "./skid-trace.ts";
import type { SkidLaneTrace } from "../types/skid.ts";

const read = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/data/${name}`, import.meta.url)), "utf-8"));
const RUNWAYS = ["06-24", "07L-25R"] as const;
const UNIT = Object.fromEntries(RUNWAYS.map((rw) => [rw, SkidRunwaySchema.parse(read(`skid-${rw}-2026.json`))]));
const TRACE = Object.fromEntries(RUNWAYS.map((rw) => [rw, SkidTraceSchema.parse(read(`skid-${rw}-2026-1m.json`))]));

test("F. struktur berkas per meter cocok dengan berkas per unit", () => {
  for (const rw of RUNWAYS) {
    const u = UNIT[rw], t = TRACE[rw];
    assert.equal(t.runway, rw);
    assert.deepEqual(t.lanes.map((l) => l.lane), LANE_ORDER);
    assert.equal(t.unit_bounds.starts_m.length, u.units.length);
    t.lanes.forEach((l, i) => {
      const m = u.lanes[i];
      assert.equal(l.d_first, 1);
      assert.equal(l.length_m, u.survey.measured_length_m, `${rw} ${l.lane}`);
      assert.deepEqual([l.s0_m, l.offset_m, l.file, l.gps, l.record_start_utc], [m.s0_m, m.offset_m, m.file, m.gps, m.record_start_utc]);
    });
    const r = t.reconciliation;
    assert.equal(r.unit_lane_pairs, u.units.length * 8);
    assert.deepEqual([r.n_ok, r.mu_10m_ok, r.mu_152m_ok], [r.unit_lane_pairs, r.unit_lane_pairs, r.unit_lane_pairs]);
  }
});

test("G. nilai per unit dihitung ulang dari data per meter = berkas per unit", () => {
  for (const rw of RUNWAYS) {
    const u = UNIT[rw], t = TRACE[rw];
    const covered = new Set<number>();
    let edges = 0;
    for (const unit of u.units) {
      unit.lanes.forEach((lv, li) => {
        const lane = t.lanes[li];
        const m = unitMeanFromTrace(t, lane, unit.unit);
        assert.equal(m.n, lv.n, `${rw} unit ${unit.unit} ${lv.lane} n`);
        if (m.n > 0) covered.add(unit.unit);
        if (lv.mu_10m === null) { assert.equal(m.mean, null); return; }
        assert.ok(Math.abs(m.mean! - lv.mu_10m) <= 0.00005 + 1e-9, `${rw} unit ${unit.unit} ${lv.lane} mu_10m ${m.mean} vs ${lv.mu_10m}`);
        const w = unitWindowMean(t, lane, unit.unit);
        const tol = w.edge ? 0.002 : 0.00005 + 1e-9; // bacaan tepat di tepi jendela: lihat brief §3.6
        if (w.edge) edges++;
        assert.ok(Math.abs(w.mean! - lv.mu_152m!) <= tol, `${rw} unit ${unit.unit} ${lv.lane} mu_152m ${w.mean} vs ${lv.mu_152m}`);
      });
    }
    const c = [...covered].sort((a, b) => a - b);
    assert.deepEqual([c[0], c[c.length - 1], c.length], [u.coverage.first_unit, u.coverage.last_unit, u.coverage.n_units]);
    assert.ok(edges <= 8, `${rw}: ${edges} pasangan tepi jendela`);
  }
});

test("H. rata-rata bergerak 152 m", () => {
  const flat = movingAverage(new Array(1000).fill(0.7));
  assert.ok(flat.mean.every((v) => Math.abs(v! - 0.7) < 1e-12));
  assert.deepEqual([flat.n[0], flat.n[76], flat.n[500], flat.n[999]], [77, 153, 153, 77]);
  const step = movingAverage([...new Array(500).fill(0.4), ...new Array(500).fill(0.8)]);
  assert.ok(Math.abs(step.mean[500]! - (76 * 0.4 + 77 * 0.8) / 153) < 1e-12);
  const gaps = movingAverage([0.5, null, 0.7], 1);
  assert.deepEqual([gaps.mean[0], gaps.n[1]], [0.5, 2]);
  assert.ok(Math.abs(gaps.mean[1]! - 0.6) < 1e-12);
  // garis rata-rata di grafik harus sejalan dengan μ 152 m di panel unit
  for (const rw of RUNWAYS) {
    let worst = 0;
    TRACE[rw].lanes.forEach((lane, li) => {
      const ma = movingAverage(lane.mu).mean;
      for (const unit of UNIT[rw].units) {
        const v = unit.lanes[li].mu_152m;
        if (v === null) continue;
        const i = indexAtX(TRACE[rw], lane, TRACE[rw].unit_bounds.last_end_m - TRACE[rw].unit_bounds.window_mid_m[unit.unit - 1]);
        if (i === null) continue;
        worst = Math.max(worst, Math.abs(ma[i]! - v));
      }
    });
    assert.ok(worst < 0.01, `${rw}: garis 152 m menyimpang ${worst.toFixed(4)} dari μ 152 m unit`);
  }
});

const fake = (n: number, f: (d: number) => number | null): SkidLaneTrace => ({
  lane: "L3.0", offset_m: -3, file: "x.csv", s0_m: 2704.5, gps: true, record_start_utc: "", d_first: 1, length_m: n,
  time_first: null, time_last: null, mu: Array.from({ length: n }, (_, i) => f(i + 1)), speed_kmh: new Array(n).fill(65),
  markers: [], stats: { rows: n, mu_null: 0, speed_null: 0, held_rows: 0, gps_rows: 0, mean_mu: null, mean_speed_kmh: null, min_speed_kmh: null, max_speed_kmh: null, rows_outside_speed_tol: 0 },
  header: { length: null, runway_direction: null, wetting: null, friction: null, speed_kmh: null },
});

test("I. segmen 152,4 m dan sepertiga, seperti printout alat", () => {
  const s = fixedSegments(fake(2400, (d) => d));
  assert.equal(s.length, 16);
  assert.deepEqual([s[0].dFrom, s[0].dTo, s[1].dFrom, s[1].dTo, s[2].dFrom, s[2].dTo], [1, 152, 153, 304, 305, 457]);
  assert.deepEqual([s[15].dFrom, s[15].dTo, s[15].n, s[15].partial, s[14].partial], [2287, 2400, 114, true, false]);
  assert.equal(s.reduce((a, x) => a + x.n, 0), 2400);
  assert.equal(s[0].mean, 76.5);
  const s3000 = fixedSegments(fake(3000, () => 0.7));
  assert.deepEqual([s3000.length, s3000[19].dFrom, s3000[19].n], [20, 2896, 105]);
  assert.deepEqual(thirds(fake(2400, () => 0.7)).map((x) => [x.dFrom, x.dTo, x.n]), [[1, 800, 800], [801, 1600, 800], [1601, 2400, 800]]);
  assert.deepEqual(thirds(fake(3000, () => 0.7)).map((x) => x.n), [1000, 1000, 1000]);
});

test("J. aturan FAA par. 3-20", () => {
  const ev = (means: (number | null)[], lengths?: number[]) =>
    evaluateFaa320(means.map((mean, i) => ({ mean, lengthM: lengths?.[i] ?? 152.4 }))).map((r) => r.status);
  assert.deepEqual(ev([0.65, 0.55, 0.65]), ["ok", "monitor", "ok"]);
  assert.deepEqual(ev([0.65, 0.55, 0.58, 0.65]), ["ok", "extensive", "extensive", "ok"]);
  assert.deepEqual(ev([0.58, 0.45, 0.57]), ["extensive", "immediate", "extensive"]);
  assert.deepEqual(ev([0.65, 0.45, 0.65]), ["ok", "belowMinimum", "ok"]);
  assert.deepEqual(ev([0.65, 0.45, 0.55, 0.65]), ["ok", "extensive", "extensive", "ok"]);
  assert.deepEqual(ev([0.45, 0.55, 0.7]), ["immediate", "extensive", "ok"]);
  assert.deepEqual(ev([0.55, 0.55], [152.4, 114]), ["monitor", "monitor"]);
  assert.deepEqual(ev([null, 0.7]), ["noData", "ok"]);
  // tafsir "adjacent segments" (brief §11): dua segmen < 0,50 berurutan, diapit segmen ≥ 0,60
  const pair = [0.65, 0.45, 0.45, 0.65].map((mean) => ({ mean, lengthM: 152.4 }));
  assert.deepEqual(evaluateFaa320(pair, undefined, "all").map((r) => r.status), ["ok", "extensive", "extensive", "ok"]);
  assert.deepEqual(evaluateFaa320(pair, undefined, "any").map((r) => r.status), ["ok", "immediate", "immediate", "ok"]);
  const lone = [0.65, 0.45, 0.65].map((mean) => ({ mean, lengthM: 152.4 }));
  assert.deepEqual(evaluateFaa320(lone, undefined, "any").map((r) => r.status), ["ok", "belowMinimum", "ok"]);
  const b = evaluateFaa320([0.55, 0.7, 0.66, 0.44].map((mean) => ({ mean, lengthM: 152.4 }))).map((r) => r.borderline);
  assert.deepEqual(b, [true, false, true, true]);
});

test("K. semua lajur dan semua run ada", () => {
  const files = new Set<string>();
  for (const rw of RUNWAYS) {
    assert.deepEqual(UNIT[rw].lanes.map((l) => l.code), LANE_ORDER);
    for (const lane of TRACE[rw].lanes) {
      files.add(lane.file);
      assert.ok(lane.mu.some((v) => v !== null), `${rw} ${lane.lane}: tidak ada bacaan`);
      const units = new Set(lane.mu.map((_, i) => unitAtStation(TRACE[rw], stationOf(lane, i))));
      assert.ok(units.size > 200, `${rw} ${lane.lane}: hanya ${units.size} unit`);
    }
  }
  assert.equal(files.size, 16);
});

test("L. posisi x dan unit", () => {
  const t = TRACE["06-24"];
  const lane = t.lanes[2];
  for (const i of [0, 1234, lane.mu.length - 1]) assert.equal(indexAtX(t, lane, xOf(t, lane, i)), i);
  const [x0, x1] = unitXRange(t, 240);
  const inside = lane.mu.map((_, i) => i).filter((i) => xOf(t, lane, i) > x0 && xOf(t, lane, i) <= x1);
  assert.ok(inside.every((i) => unitAtStation(t, stationOf(lane, i)) === 240));
  assert.ok(xOf(t, lane, 0) > 250 && xOf(t, lane, 0) < 350, "rekaman mulai ±300 m dari ujung 06");
});

test("M. data grafik (ember min–maks) dan potongan kelas", () => {
  for (const rw of RUNWAYS) {
    const t = TRACE[rw];
    const full: [number, number] = [0, t.unit_bounds.last_end_m];
    const ma = new Map(t.lanes.map((l) => [l.lane, movingAverage(l.mu).mean]));
    const rows = profileRows(t, t.lanes, full, 1000, ma);
    assert.ok(rows.length <= 1001 && rows.length >= 999, `${rw}: ${rows.length} baris`);
    for (const lane of t.lanes) {
      const k = laneKey(lane.lane);
      const vals = lane.mu.filter((v): v is number => v !== null);
      const lo = rows.map((r) => r[`lo_${k}`]).filter((v): v is number => v !== null);
      const hi = rows.map((r) => r[`hi_${k}`]).filter((v): v is number => v !== null);
      assert.equal(Math.min(...lo), Math.min(...vals), `${rw} ${lane.lane}: bacaan terendah harus tetap terlihat`);
      assert.equal(Math.max(...hi), Math.max(...vals));
      assert.equal(rows[0][`lo_${k}`], null, "awal runway tidak terekam");
    }
    // diperbesar: 1 baris = 1 m, nilai = bacaan asli
    const lane = t.lanes[2];
    const zoom = profileRows(t, [lane], [1000, 1200], 1000, ma);
    assert.equal(zoom.length, 200);
    for (const r of zoom) {
      const i = Math.ceil(r.x - (t.unit_bounds.last_end_m - lane.s0_m + lane.d_first));
      assert.equal(r[`lo_${laneKey(lane.lane)}`], lane.mu[i]);
      assert.equal(r[`hi_${laneKey(lane.lane)}`], lane.mu[i]);
      assert.equal(r[`ma_${laneKey(lane.lane)}`], ma.get(lane.lane)![i]);
    }
  }
  assert.equal(laneKey("L3.0"), "L3_0");
  const runs = meterRuns([0.45, 0.46, 0.55, null, null, 0.9]);
  assert.deepEqual(runs.map((r) => [r.cls, r.iFrom, r.iTo]), [["belowMinimum", 0, 1], ["belowMaintenance", 2, 2], ["noData", 3, 4], ["newDesign", 5, 5]]);
});
