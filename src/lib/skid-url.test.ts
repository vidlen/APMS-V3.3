/**
 * skid-url.test.ts — status tampilan di URL (P) dan tanda 100 ft (Q). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SkidTraceSchema } from "./skid-schema.ts";
import { feetMarks } from "./skid-trace.ts";
import { parseSkidUrl, skidUrlSearch } from "./skid-url.ts";

const read = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/data/${name}`, import.meta.url)), "utf-8"));

test("P. URL: baca, validasi, dan tulis kembali tanpa mengubah kunci lain", () => {
  assert.deepEqual(parseSkidUrl("?tab=skid&rw=07L-25R&unit=301&lane=L3.0"), { runway: "07L-25R", unit: 301, lane: "L3.0" });
  assert.deepEqual(parseSkidUrl("?rw=06-24&unit=300&basis=10m&view=compare&lanes=R3.0,L3.0,R3.0&x=1000-1500.5"), {
    runway: "06-24", unit: 300, basis: "10m", view: "compare", lanes: ["R3.0", "L3.0"], x: [1000, 1500.5],
  });
  // nilai tidak sah dibuang, bukan ditebak
  assert.deepEqual(parseSkidUrl("?rw=99&unit=361&lane=L9.9&basis=5m&view=zzz&lanes=a,b&x=900-100"), {});
  assert.deepEqual(parseSkidUrl("?rw=06-24&unit=301"), { runway: "06-24" }, "unit 301 tidak ada di 06/24 (300 unit)");
  assert.deepEqual(parseSkidUrl("?unit=300"), { unit: 300 }, "tanpa rw dianggap 06/24");
  assert.deepEqual(parseSkidUrl("?unit=0"), {});
  assert.deepEqual(parseSkidUrl(""), {});

  const s = skidUrlSearch("?tab=skid&other=1", { runway: "07L-25R", unit: 301, lane: "L3.0", basis: "10m", view: "one", x: null });
  assert.equal(s, "tab=skid&other=1&rw=07L-25R&unit=301&lane=L3.0", "kunci lain tetap, default tidak ditulis");
  const back = skidUrlSearch(`?${s}`, { runway: "07L-25R", basis: "152m", view: "compare", lanes: ["L3.0", "R3.0"], x: [1000.4, 1500.6] });
  assert.equal(back, "tab=skid&other=1&rw=07L-25R&lanes=L3.0,R3.0&basis=152m&view=compare&x=1000-1501", "unit dan lane hilang bila tidak ada");
  // ditulis lalu dibaca = sama
  assert.deepEqual(parseSkidUrl(`?${back}`), { runway: "07L-25R", basis: "152m", view: "compare", lanes: ["L3.0", "R3.0"], x: [1000, 1501] });
});

test("Q. tanda tiap 100 ft: posisi, kelipatan, dan batas rekaman", () => {
  const rt = SkidTraceSchema.parse(read("skid-06-24-2026-1m.json"));
  const lane = rt.lanes.find((l) => l.lane === "L3.0")!;
  const base = rt.unit_bounds.last_end_m - lane.s0_m;

  const marks = feetMarks(rt, lane, [500, 1100]);
  assert.ok(marks.length >= 19 && marks.length <= 21, `600 m / 30,48 m = ~20 tanda, dapat ${marks.length}`);
  assert.ok(marks.every((m) => m.feet % 100 === 0 && m.x >= 500 && m.x <= 1100));
  for (const m of marks) assert.ok(Math.abs(m.x - (base + (m.feet / 100) * 30.48)) < 1e-9);
  assert.ok(marks.slice(1).every((m, i) => Math.abs(m.x - marks[i].x - 30.48) < 1e-9), "jarak antar tanda 30,48 m");

  assert.equal(feetMarks(rt, lane, [0, 200]).length, 0, "sebelum rekaman mulai tidak ada tanda (rekaman mulai ~295 m)");
  const all = feetMarks(rt, lane, [0, rt.unit_bounds.last_end_m]);
  assert.equal(all.length, Math.floor(2400 / 30.48), "seluruh rekaman 2.400 m = 78 tanda, tidak lewat ujung rekaman");
  assert.equal(all[0].feet, 100);
});
