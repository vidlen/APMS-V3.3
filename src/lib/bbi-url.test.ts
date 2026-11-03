/**
 * bbi-url.test.ts — status tampilan tab Roughness di URL (brief §10.2 uji L). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bbiUrlSearch, parseBbiUrl } from "./bbi-url.ts";

test("L. URL: baca, validasi, dan tulis kembali tanpa mengubah kunci lain", () => {
  assert.deepEqual(parseBbiUrl("?tab=bbi&rw=06-24&unit=199&line=P02_L"), { runway: "06-24", unit: 199, line: "P02_L" });
  assert.deepEqual(parseBbiUrl("?survey=2027-06&rw=07L-25R&unit=360&view=compare&lines=P02_L,P01_L,P02_L&x=1000-1500.5"), {
    survey: "2027-06", runway: "07L-25R", unit: 360, view: "compare", lines: ["P02_L", "P01_L"], x: [1000, 1500.5],
  });
  // nilai tidak sah dibuang, bukan ditebak
  assert.deepEqual(parseBbiUrl("?survey=A B&rw=99&unit=361&line=L3.0&lines=a,b&view=zzz&x=900-100"), {});
  assert.deepEqual(parseBbiUrl("?rw=06-24&unit=301"), { runway: "06-24" }, "unit 301 tidak ada di 06/24 (300 unit)");
  assert.deepEqual(parseBbiUrl("?rw=07L-25R&unit=301"), { runway: "07L-25R", unit: 301 });
  assert.deepEqual(parseBbiUrl("?unit=300"), { unit: 300 }, "tanpa rw dianggap 06/24");
  assert.deepEqual(parseBbiUrl("?unit=0"), {});
  assert.deepEqual(parseBbiUrl(""), {});
  assert.deepEqual(parseBbiUrl("?lines=P01_L,P01_R,P02_L,P02_R,P03_L").lines, ["P01_L", "P01_R", "P02_L", "P02_R"], "paling banyak 4 garis");

  const s = bbiUrlSearch("?tab=bbi&other=1", { runway: "06-24", unit: 199, line: "P02_L", view: "one", x: null });
  assert.equal(s, "tab=bbi&other=1&rw=06-24&unit=199&line=P02_L", "kunci lain tetap, default tidak ditulis");
  const back = bbiUrlSearch(`?${s}`, { survey: "2027-06", runway: "06-24", view: "compare", lines: ["P01_L", "P01_R"], x: [1000.4, 1500.6] });
  assert.equal(back, "tab=bbi&other=1&rw=06-24&survey=2027-06&lines=P01_L,P01_R&view=compare&x=1000-1501", "unit dan line hilang bila tidak ada");
  // ditulis lalu dibaca = sama
  assert.deepEqual(parseBbiUrl(`?${back}`), { survey: "2027-06", runway: "06-24", lines: ["P01_L", "P01_R"], view: "compare", x: [1000, 1501] });
  assert.deepEqual(parseBbiUrl(`?${bbiUrlSearch("", { runway: "06-24", view: "all", x: null })}`), { runway: "06-24", view: "all" });
});
