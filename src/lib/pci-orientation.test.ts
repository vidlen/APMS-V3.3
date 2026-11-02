/**
 * pci-orientation.test.ts
 * -----------------------------------------------------------------------------
 * Jangkar GPS untuk arah muatan PCI (docs/penomoran-unit.md, "Arah muatan PCI").
 *
 * Tekstur makro LCMS Juni 2026 berposisi GPS, jadi letaknya tidak bergantung pada
 * nomor unit siapa pun. Raveling menaikkan MPD, sehingga pada berkas PCI yang
 * muatannya berada di tempat yang benar, MPD per unit harus berkorelasi POSITIF
 * dengan luas raveling per unit, dan lebih kuat daripada kalau muatannya dibalik.
 * Uji ini menangkap kalau ada berkas tahun survei yang kembali terbalik.
 *
 * Fikstur: src/lib/__fixtures__/tekstur-mpd-2026.json (MPD per unit web, 300 + 360 nilai).
 * Hanya berkas yang memuat raveling yang bisa diuji (06/24 2025-2026, 07L/25R 2025-2026).
 * -----------------------------------------------------------------------------
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { GeoJSONFeatureCollection } from './geojson-types.ts';

const load = <T>(relativePath: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf-8'));

const mpdFixture = load<Record<'06-24' | '07L-25R', (number | null)[]>>('./__fixtures__/tekstur-mpd-2026.json');

function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let q = i; q <= j; q++) out[order[q][1]] = (i + j) / 2;
    i = j + 1;
  }
  return out;
}

function pearson(x: number[], y: number[]): number {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

const spearman = (x: number[], y: number[]) => pearson(ranks(x), ranks(y));

function ravelingByUnit(fc: GeoJSONFeatureCollection, n: number): number[] {
  const byUnit = new Map(fc.features.map((f) => [f.properties.sampleUnit as number, f]));
  return Array.from({ length: n }, (_, i) => {
    const distresses = (byUnit.get(i + 1)?.properties.distresses ?? []) as { type: string; quantity: number }[];
    return distresses.filter((d) => /ravel/i.test(d.type)).reduce((sum, d) => sum + Number(d.quantity), 0);
  });
}

const cases = [
  { runway: '06-24', n: 300, years: [2025, 2026] },
  { runway: '07L-25R', n: 360, years: [2025, 2026] },
] as const;

test('fixture tekstur memuat satu nilai per unit web', () => {
  assert.equal(mpdFixture['06-24'].length, 300);
  assert.equal(mpdFixture['07L-25R'].length, 360);
});

for (const { runway, n, years } of cases) {
  for (const year of years) {
    test(`RWY ${runway} ${year}: raveling sejalan dengan tekstur LCMS berposisi GPS (muatan tidak terbalik)`, () => {
      const fc = load<GeoJSONFeatureCollection>(`../../public/data/runway-${runway}-units-${year}.json`);
      const raveling = ravelingByUnit(fc, n);
      const mpd = mpdFixture[runway];
      const keep = mpd.map((v) => v !== null);
      const m = mpd.filter((v): v is number => v !== null);
      const pick = (values: number[]) => values.filter((_, i) => keep[i]);

      const asIs = spearman(m, pick(raveling));
      const flipped = spearman(m, pick([...raveling].reverse()));
      assert.ok(asIs > 0.3, `Spearman MPD~raveling ${asIs.toFixed(3)} (harus > 0,3)`);
      assert.ok(asIs > flipped, `susunan sekarang ${asIs.toFixed(3)} kalah dari kalau dibalik ${flipped.toFixed(3)}`);
    });
  }
}
