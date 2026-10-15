/**
 * skid.test.ts — uji data per unit (A–E). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifySkid, LANE_ORDER } from "../config/skid.ts";
import type { SkidClass } from "../config/skid.ts";
import { SkidRunwaySchema } from "./skid-schema.ts";
import { makeStationProjector } from "./skid-geo.ts";
import { governingFor as governing, summarize } from "./skid.ts";

const read = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/data/${name}`, import.meta.url)), "utf-8"));
const RW = { "06-24": SkidRunwaySchema.parse(read("skid-06-24-2026.json")), "07L-25R": SkidRunwaySchema.parse(read("skid-07L-25R-2026.json")) };

test("A. klasifikasi di batas ambang", () => {
  const cases: [number | null, SkidClass][] = [
    [0.4999, "belowMinimum"], [0.5, "belowMaintenance"], [0.5999, "belowMaintenance"],
    [0.6, "aboveMaintenance"], [0.8199, "aboveMaintenance"], [0.82, "newDesign"], [null, "noData"],
  ];
  for (const [mu, cls] of cases) assert.equal(classifySkid(mu), cls, String(mu));
});

test("B. struktur berkas per unit", () => {
  for (const [rw, d] of Object.entries(RW)) {
    assert.equal(d.units.length, rw === "06-24" ? 300 : 360);
    d.units.forEach((u, k) => {
      assert.equal(u.unit, k + 1);
      assert.deepEqual(u.lanes.map((l) => l.lane), LANE_ORDER);
      for (const b of ["10m", "152m"] as const) {
        const g = governing(u, b);
        assert.equal(g === null, u.lanes_measured === 0, `${rw} unit ${u.unit}`);
        const vals = u.lanes.map((l) => (b === "152m" ? l.mu_152m : l.mu_10m)).filter((v): v is number => v !== null);
        if (g) assert.equal(g.mu, Math.min(...vals));
      }
    });
  }
});

// C. Kecocokan penomoran dengan berkas unit yang DIPAKAI WEB (wajib; kalau gagal, berhenti dan laporkan).
type Feature = { properties: { sampleUnit: number; pci_score?: number }; geometry: { type: string; coordinates: number[][][] } };
const ringCentroid = (f: Feature): [number, number] => {
  const ring = f.geometry.coordinates[0].slice(0, -1); // titik penutup tidak ikut
  return [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
};
const metres = (a: readonly [number, number], b: readonly [number, number]) => {
  const k = (Math.PI / 180) * 6371008.8;
  return Math.hypot((b[0] - a[0]) * k * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * k);
};

test("C. penomoran unit skid = penomoran berkas unit web", () => {
  for (const rw of ["06-24", "07L-25R"] as const) {
    const web = (read(`runway-${rw}-units-2026.json`) as { features: Feature[] }).features;
    const byUnit = new Map(web.map((f) => [f.properties.sampleUnit, f]));
    let worst = 0;
    for (const u of RW[rw].units) {
      const f = byUnit.get(u.unit);
      assert.ok(f, `${rw}: unit ${u.unit} tidak ada di berkas unit web`);
      worst = Math.max(worst, metres(u.centroid_lonlat, ringCentroid(f)));
    }
    assert.ok(worst < 2, `${rw}: centroid meleset ${worst.toFixed(1)} m — berkas unit beda versi/penomoran`);
    const units = RW[rw].units;
    assert.ok(units[0].centroid_lonlat[0] > units[units.length - 1].centroid_lonlat[0], `${rw}: unit 1 harus di ujung timur`);
  }
  const u1 = (read("runway-07L-25R-units-2026.json") as { features: Feature[] }).features.find((f) => f.properties.sampleUnit === 1);
  assert.equal(u1?.properties.pci_score, 93, "07L/25R unit 1 di berkas web harus PCI 93 (ujung 25R)");
});

test("D. angka penerimaan", () => {
  const expected = {
    "06-24": { "152m": [63, 27, 144, 7, 59, 240, "L3.0", 0.3483], "10m": [69, 28, 137, 7, 59, 238, "L3.0", 0.2739] },
    "07L-25R": { "152m": [18, 33, 251, 0, 58, 301, "L3.0", 0.4466], "10m": [31, 29, 237, 5, 58, 306, "L4.5", 0.3741] },
  } as const;
  const order: SkidClass[] = ["belowMinimum", "belowMaintenance", "aboveMaintenance", "newDesign", "noData"];
  for (const rw of ["06-24", "07L-25R"] as const) {
    for (const b of ["152m", "10m"] as const) {
      const e = expected[rw][b];
      const s = summarize(RW[rw], b);
      assert.deepEqual(order.map((c) => s.counts[c]), e.slice(0, 5), `${rw} ${b}`);
      assert.deepEqual([s.lowest?.unit, s.lowest?.lane, s.lowest?.mu], e.slice(5), `${rw} ${b} lowest`);
      assert.equal(s.measured, rw === "06-24" ? 241 : 302);
    }
  }
  const zones = (rw: "06-24" | "07L-25R") => RW[rw].units.filter((u) => classifySkid(u.governing_152m?.mu ?? null) === "belowMinimum").map((u) => u.unit);
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  assert.deepEqual(zones("06-24"), [...range(54, 91), ...range(227, 251)]);
  assert.deepEqual(zones("07L-25R"), [...range(48, 51), ...range(295, 308)]);
});

test("E. geometri lajur (tanpa ol)", () => {
  for (const rw of ["06-24", "07L-25R"] as const) {
    const units = RW[rw].units;
    const project = makeStationProjector(units);
    for (const u of units) {
      const c = project(u.station_mid_m, 0);
      const m = [6378137 * (u.centroid_lonlat[0] * Math.PI) / 180, 6378137 * Math.log(Math.tan(Math.PI / 4 + (u.centroid_lonlat[1] * Math.PI) / 360))];
      assert.ok(Math.hypot(c[0] - m[0], c[1] - m[1]) < 0.01, `${rw} unit ${u.unit}: titik tengah harus di centroid`);
    }
    const u = units[rw === "07L-25R" ? 300 : 150]; // 07L/25R: unit 301
    const s = u.station_mid_m;
    const cl = project(s, 0), l3 = project(s, -3), r3 = project(s, 3), ahead = project(s + 1, 0);
    const scale = Math.hypot(ahead[0] - cl[0], ahead[1] - cl[1]); // meter Mercator per meter tanah
    assert.ok(l3[1] > cl[1] && r3[1] < cl[1], `${rw}: L3.0 harus di utara sumbu, R3.0 di selatan`);
    const lateral = Math.hypot(l3[0] - r3[0], l3[1] - r3[1]) / scale;
    assert.ok(Math.abs(lateral - 6) < 0.1, `${rw}: jarak L3.0–R3.0 ${lateral.toFixed(3)} m`);
  }
});
