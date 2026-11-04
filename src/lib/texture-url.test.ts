/**
 * texture-url.test.ts — status tampilan tab Macrotexture di URL (brief tekstur §10.2 uji L). Jalankan: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TEXTURE_URL_KEYS, parseTextureUrl, textureUrlSearch } from "./texture-url.ts";

test("L. URL: baca, validasi, dan tulis kembali tanpa mengubah kunci lain", () => {
  assert.deepEqual(parseTextureUrl("?tab=texture&rw=06-24&unit=14&zone=1&mode=mpd&x=85-185.5"), { runway: "06-24", unit: 14, zone: 1, mode: "mpd", x: [85, 185.5] });
  assert.deepEqual(parseTextureUrl("?survey=2027-06&rw=07L-25R&unit=360&zone=all&mode=etd"), { survey: "2027-06", runway: "07L-25R", unit: 360, zone: "all", mode: "etd" });
  // nilai tidak sah dibuang, bukan ditebak
  assert.deepEqual(parseTextureUrl("?survey=A B&rw=99&unit=361&zone=4&mode=zzz&x=900-100"), {});
  assert.deepEqual(parseTextureUrl("?rw=06-24&unit=301"), { runway: "06-24" }, "unit 301 tidak ada di 06/24 (300 unit)");
  assert.deepEqual(parseTextureUrl("?rw=07L-25R&unit=301"), { runway: "07L-25R", unit: 301 });
  assert.deepEqual(parseTextureUrl("?unit=300"), { unit: 300 }, "tanpa rw dianggap 06/24");
  assert.deepEqual(parseTextureUrl("?unit=0&zone=0&x=5000-6000"), {});
  assert.deepEqual(parseTextureUrl(""), {});

  const s = textureUrlSearch("?tab=texture&other=1", { runway: "06-24", unit: 14, zone: "all", mode: "etd", x: null });
  assert.equal(s, "tab=texture&other=1&rw=06-24&unit=14", "kunci lain tetap, default tidak ditulis");
  const back = textureUrlSearch(`?${s}`, { survey: "2027-06", runway: "07L-25R", zone: 2, mode: "mpd", x: [84.9, 184.9] });
  assert.equal(back, "tab=texture&other=1&rw=07L-25R&survey=2027-06&zone=2&mode=mpd&x=85-185", "unit hilang bila tidak ada");
  // ditulis lalu dibaca = sama
  assert.deepEqual(parseTextureUrl(`?${back}`), { survey: "2027-06", runway: "07L-25R", zone: 2, mode: "mpd", x: [85, 185] });
  assert.deepEqual([...TEXTURE_URL_KEYS], ["survey", "rw", "unit", "zone", "mode", "x"]);
});
