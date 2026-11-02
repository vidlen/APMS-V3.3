# Brief: balik muatan PCI ke lokasi yang benar

Untuk Claude Code, repo APMS-V3.3. Disusun 2 November 2026.

## 1. Tujuan

Muatan survei PCI (`pci_score`, `pci_rating`, `distresses`) pada sebagian berkas `public/data/runway-*-units-*.json` berada di ujung runway yang salah. Pindahkan muatan itu ke unit seberang:

```
muatan unit k  <-  muatan unit N + 1 - k        N = 300 (RWY 06/24), 360 (RWY 07L/25R)
```

Geometri, `id`, `square_id`, dan `sampleUnit` tiap fitur **tidak berubah**. Nomor unit tetap menunjuk lokasi yang sama (unit 1 di ujung 06 / 07L, `docs/penomoran-unit.md`). Yang pindah hanya nilai survei.

## 2. Kenapa

Penomoran ulang 21 Oktober hanya memindahkan label. Muatan PCI tetap di lokasi yang diasumsikan laporan survei, yaitu unit 1 di ujung 24 / 25R. Asumsi itu ternyata terbalik.

Jangkarnya adalah CSV "LCMS Texture Processed" Juni 2026. CSV ini berasal dari survei LCMS yang sama dengan PCI 2026 (SurveyId `RUNWAY 2406 PCI` dan "RUNWAY UTARA … PAKAI PCI"). Setiap segmen 10 m membawa poligon ber-GPS, jadi letaknya tidak bergantung pada nomor unit. Raveling menaikkan MPD, sehingga MPD per unit harus berkorelasi positif dengan luas raveling per unit.

| Berkas di repo | Spearman MPD lawan raveling, sekarang | Kalau muatan dibalik |
|---|---|---|
| 06/24 2025 | **+0,62** | −0,24 |
| 06/24 2026 | −0,24 | **+0,68** |
| 07L/25R 2025 | ≈0 | **+0,61** |
| 07L/25R 2026 | ≈0 | **+0,66** |

Bukti pendukung:
- Pola yang sama bertahan di bagian tengah runway, jauh dari endapan karet zona touchdown: 06/24 +0,48 lawan −0,23, 07L/25R +0,52 lawan −0,27.
- Kecocokan terbaik jatuh tepat di posisi cermin, dengan geser 0–1 unit.
- Korelasi PCI 06/24 2025 lawan 2026 naik dari −0,26 menjadi +0,77. Unit yang PCI-nya naik lebih dari 10 poin dalam setahun turun dari 72 menjadi 12.
- Mobil LCMS mulai dari ujung 06 / 07L. Baris pertama CSV tekstur 06/24 ada di ujung 06 dengan arah 56°, dan baris pertama 07L/25R di ujung 07L dengan arah 68°.
- Sesudah dibalik, nomor unit Excel/PAVER 2025–2026 sama dengan nomor unit web. Contoh: unit 16 RWY 06/24 2026 (PCI 45,6 di gambar laporan) menjadi unit 16 di web, berpasangan dengan PCI 2025 unit 16 = 77,02. Pasangan ini sama persis dengan fikstur `UNIT_285` di `risk-unit.test.ts`.

Data skid (Moventor) dan tekstur sudah berposisi GPS dan benar. Keduanya **tidak** disentuh.

## 3. Lingkup

**Dibalik (8 berkas):**
- `public/data/runway-06-24-units-2026.json`
- `public/data/runway-07L-25R-units-2020.json` sampai `2026.json` (7 berkas). Ketujuhnya saling searah: korelasi antar tahun berurutan semuanya positif. Berkas 2020–2024 tidak memuat raveling, jadi ikut blok 2025–2026.

**Tidak dibalik:**
- 06/24 2025: sudah searah GPS.
- 06/24 2023–2024: nyaris tanpa kerusakan, tidak dapat diuji.
- Semua berkas skid, `src/config/skid-unit-stations-2026.json`, medan stasiun, rumus `stationKm`, dan aturan zona.

## 4. Bahan yang sudah ada di repo (belum dipakai, belum terdaftar)

Ketiganya ditulis dan diuji di luar repo dengan Node 22. Tinjau dulu sebelum dipakai.

| Berkas | Isi |
|---|---|
| `scripts/balik-muatan-pci.mjs` | Skrip pembalik. Cek (bawaan), `--write`, `--undo`, uji jangkar opsional `--tekstur-06-24 <csv> --tekstur-07L-25R <csv>`. Menyunting JSON sebagai teks seperti `renumber-units.mjs`. Memberi penanda `muatan_pci_dibalik` di tingkat atas supaya tidak membalik dua kali. Memverifikasi geometri dan nomor tetap, dan muatan unit k = muatan lama unit N+1−k. |
| `src/lib/pci-orientation.test.ts` | Uji permanen jangkar GPS. Untuk 06/24 dan 07L/25R tahun 2025–2026: Spearman MPD lawan raveling harus > 0,3 dan lebih besar daripada kalau dibalik. Pada data sekarang gagal 3 dari 5; sesudah dibalik lulus 5 dari 5. |
| `src/lib/__fixtures__/tekstur-mpd-2026.json` | MPD rata-rata per unit web (300 + 360 nilai). Posisi tiap segmen = centroid poligon `AvgGeoJSON`, diproyeksikan ke sumbu runway dari centroid poligon unit, ke unit terdekat sepanjang sumbu, \|offset\| ≤ 30 m, MPD ≤ 0 dibuang. |

Uji yang sudah dijalankan di luar repo:
- `--write` lalu `--undo --write` mengembalikan kedelapan berkas identik byte demi byte.
- Menjalankan `--write` dua kali tidak membalik ulang.
- `node scripts/renumber-units.mjs` tetap bersih sesudah pembalikan.

## 5. Langkah kerja

1. **Cek keadaan.** Jalankan `git status`. Pastikan kedelapan berkas belum memuat `muatan_pci_dibalik`.
2. **Jalankan mode cek dengan jangkar:**
   ```
   node scripts/balik-muatan-pci.mjs --tekstur-06-24 "D:\Skripsi\Data Macro n Roughness\Runway 06-24 Juni 2026\macro texture\Runway 24 Tggl 28 Juni 2026_LCMS Texture Processed.csv" --tekstur-07L-25R "D:\Skripsi\Data Macro n Roughness\Runway Utara Juni 2026\Macro Texture\RUNWAY UTARA 18 JUNI 2026 PAKAI PCI_LCMS Texture Processed.csv"
   ```
   Keluaran harus menyebut 8 berkas "balik". Korelasi 06/24 2025-2026 harus naik dari −0,261 ke +0,767. "Sesudah" MPD~raveling harus sekitar +0,62 / +0,68 (06/24 2025 / 2026) dan +0,61 / +0,66 (07L/25R 2025 / 2026). Kalau angkanya jauh berbeda, **berhenti dan laporkan ke user**.
3. **Tulis:** jalankan perintah yang sama dengan `--write`.
4. **Sesuaikan uji yang mengunci nilai pada nomor unit** (Lampiran A). Nilai yang diharapkan tidak berubah; yang berubah hanya nomor unit tempat nilai itu sekarang berada.
5. **Daftarkan uji baru:** tambahkan `src/lib/pci-orientation.test.ts` di akhir daftar skrip `"test"` di `package.json`. Berkas itu ber-CRLF, jadi pertahankan.
6. **Perbaiki komentar usang** di `src/lib/risk-unit-adapter.ts` (Lampiran B).
7. **Perbarui `docs/penomoran-unit.md`** (Lampiran C).
8. **Periksa:** `npm test` (seluruhnya hijau, termasuk 5 uji orientasi) dan `npm run build`.
9. **Commit** dengan pesan seperti `PCI: balik muatan 06/24 2026 dan 07L/25R 2020-2026 ke lokasi GPS`. **Jangan push** sebelum user mengonfirmasi lewat foto LCMS (bagian 7).

## 6. Kriteria selesai

- Unit 1 RWY 06/24 2026: PCI 99, distress `[{Raveling, Low, 0.06 SqM, deduct 1}]`. Unit 300: PCI 100, distress `[]`.
- Unit 16 RWY 06/24 2026: PCI 45,6, kelas laju `memburuk_cepat` (PCI 2025 = 77,02).
- Unit 302 RWY 07L/25R 2026: PCI 49,2, FODp 70, C 15, R 90, sel 3C. Unit 261: PCI 50,6, sel 3C.
- Korelasi PCI tahun berurutan positif untuk kedua runway, sehingga allowlist `06/24:2025-2026` kosong.
- Geometri tiap unit identik dengan sebelum perubahan. Uji `U1` dan "runway geometry … identical" tetap lulus.
- Hitungan agregat B-R3 (uji 14 di `risk-unit.test.ts`) tetap lulus tanpa diubah, karena sebaran per tahun tidak bergantung pada lokasi.

## 7. Catatan untuk user (sampaikan, jangan dikerjakan)

- **Konfirmasi visual sebelum push.** Buka foto LCMS `LCMS_RUNWAY 2406 PCI_202606290102_2062903736_000027.jpg` (unit web 16, 150–160 m dari ambang 06) dan `…_000296.jpg` (unit web 285, 150–160 m dari ambang 24). Foto yang raveling-nya parah menunjukkan letak unit dengan PCI 45,6. Kalau ternyata `000296`, batalkan dengan `node scripts/balik-muatan-pci.mjs --undo --write` dan kembalikan uji.
- Edit `unitScores` di halaman Admin yang sudah dipublikasikan ke Blob untuk 06/24 2026 atau 07L/25R kini menempel pada muatan unit seberang. Periksa di Admin.
- `runway-07L-25R-units-2024.json` berisi PCI 2025 yang dibulatkan satu desimal (360 dari 360 unit, selisih ≤ 0,05), padahal survei 2024 runway itu tidak ada. Di luar lingkup brief ini.
- Paket BBI (`D:\Skripsi\Data Macro n Roughness\BBI_RWY0624`) berlabel penomoran lama. File `hasil_bbi\*_web.csv` sudah dibuat dengan `unit_web = 301 − unit_lama`. BBI belum masuk web.

---

## Lampiran A. Penyesuaian uji

### `src/lib/risk-unit-adapter.test.ts`

Allowlist dikosongkan:

```ts
// lama
const allowedNegativePciCorrelations = new Set([
  '06/24:2025-2026',
]);
// baru
// Empty since the 2 Nov 2026 payload flip: 06/24 2025-2026 went from -0.261 to +0.767
// (docs/penomoran-unit.md, "Arah muatan PCI").
const allowedNegativePciCorrelations = new Set<string>();
```

Uji titik ujung 06/24:

```ts
// komentar + judul baru
// Unit 1 is the threshold-06 end and unit 300 the threshold-24 end (renumbered 21 Oct 2026). The 2026 payload
// was flipped on 2 Nov 2026 to agree with the GPS-positioned LCMS texture; 2023-2025 did not move.
// docs/penomoran-unit.md has the details.
test('RWY 06/24 endpoint survey payloads sit at the threshold the GPS anchor puts them', () => {

// baris 2026
    { year: 2026, rwy06Pci: 99, rwy24Pci: 100 },

// distress
  assert.deepEqual(unit1?.properties.distresses, [
    { type: 'Raveling', severity: 'Low', quantity: 0.06, quantityUnits: 'SqM', deduct: 1 },
  ]);
  assert.deepEqual(unit300?.properties.distresses, []);
```

### `src/lib/risk-unit.test.ts`

- Ganti nama fikstur dan `unitNumber`: `UNIT_36` → `UNIT_265` (265), `UNIT_285` → `UNIT_16` (16), `UNIT_80` → `UNIT_221` (221). Nilai fikstur tidak berubah; sesudah pembalikan, nilai-nilainya memang berada di unit itu pada data asli.
- Komentar blok fikstur:
  ```
   * Fixtures - units 265, 16, 221. These are also the PAVER/Excel numbers: since the 2 Nov 2026 payload
   * flip (scripts/balik-muatan-pci.mjs, docs/penomoran-unit.md) web unit n carries Excel unit n for
   * 2025 and 2026. Real 2025-survey distress records ...
  ```
- Komentar uji 2: `// Section 6: unit 221's dominant distress by deduct is now PATCHING (2.7 > 1.0).`
- Judul uji 5: `'5. unit 16 is memburuk_cepat, unit 265 is stabil'`
- Uji 12:
  ```ts
  // Unit numbers follow the 2 Nov 2026 payload flip (docs/penomoran-unit.md): the 06/24 2026 and all
  // 07L/25R payloads moved from unit k to N + 1 - k (06/24 2026: 285 -> 16, 1 -> 300; 07L/25R: 59 -> 302,
  // 100 -> 261). 06/24 2025 did not move. Web unit n is now Excel/PAVER unit n for 2025-2026.
  assert.equal(degreeFor('06/24', 2025, 2024, 16, 'pci'), 1);
  assert.equal(degreeFor('06/24', 2026, 2025, 16, 'pci'), 3);
  assert.equal(degreeFor('06/24', 2026, 2025, 300, 'pci'), 1);
  assert.equal(degreeFor('07L/25R', 2026, 2025, 302, 'pci'), 3);
  assert.equal(degreeFor('07L/25R', 2026, 2025, 261, 'pci'), 3);
  ```
- Uji 13: ganti komentar, lalu ubah nomor unit baris 2026 saja. Baris 2025 tidak berubah.
  ```ts
  // After the 2 Nov 2026 payload flip the 2026 rows moved to N + 1 - k (06/24 2026: 285, 43, 1 -> 16, 258, 300;
  // 07L/25R 2026: 59, 100 -> 302, 261); 06/24 2025 rows did not move. Expected values are unchanged.
  ['06/24', 2026, 2025, 16, 45.6, 60, 5, 15, 6, 90, 3, '3C'],
  ['06/24', 2026, 2025, 258, 59.9, 40, 4, 7, 3, 10.5, 1, '2D'],
  ['06/24', 2026, 2025, 300, 100, 0, 1, 1, 0.5, 0.05, 1, '1E'],
  ['07L/25R', 2026, 2025, 302, 49.2, 70, 6, 15, 6, 90, 3, '3C'],
  ['07L/25R', 2026, 2025, 261, 50.6, 50, 5, 15, 6, 90, 3, '3C'],
  ```

Semua nilai di atas sudah diverifikasi di luar repo: 104 uji PCI/risiko lulus, ditambah 5 uji orientasi.

## Lampiran B. Komentar `src/lib/risk-unit-adapter.ts`

Ganti
`(unit 16's - unit 285 since the 21 Oct 2026 renumbering - Raveling High 4.92 m2 only reproduces its published density`
dengan
`(unit 16's 2025-survey Raveling High 4.92 m2 - unit 16 in the web and in PAVER alike - only reproduces its published density`.

Catatan itu memang sudah usang: catatan 4,92 m² itu ada di unit 16 berkas 2025, yang tidak ikut dibalik.

## Lampiran C. `docs/penomoran-unit.md`

Ganti bagian **"Yang dipakai untuk menyandingkan dengan sumber lain"** dengan:

> Sejak pembalikan muatan 2 November 2026 (bagian berikut), **nomor unit Excel/PAVER survei 2025 dan 2026 sama dengan nomor unit web**, untuk kedua runway. Unit 1 di berkas sumber ternyata secara fisik berada di ujung 06 / 07L, searah survei LCMS. Contoh: unit 16 RWY 06/24 2026 (PCI 45,6 di gambar laporan) adalah unit 16 di web.
>
> - RWY 06/24: terverifikasi dari gambar laporan PCI 2026 (unit 1–20) dan nilai acuan 2025 (unit 16 = 77,02, unit 265 = 66,59, unit 221 = 96,32).
> - RWY 07L/25R: disimpulkan dari catatan penomoran sebelumnya. Cocokkan satu unit dengan Excel sebelum menyandingkan per nomor.
> - Paket `BBI_RWY0624` (MATLAB/ProFAA) masih berlabel lama: `unit_web = 301 − unit_lama`. Jalankan `node konversi_unit_web.mjs` di folder paket untuk mendapat `hasil_bbi/*_web.csv`.
> - Paket `TEKSTUR_2026` sudah memakai penomoran web.
> - Nomor acuan di spesifikasi dan brief lama (unit 16, 221, 258, 265 pada 06/24; unit 59, 100, 301 pada 07L/25R) ditulis pada berbagai konvensi. Cocokkan lewat nilai PCI, jangan lewat nomor.

Tambahkan bagian baru **"Arah muatan PCI (2 November 2026)"**. Isinya ringkasan bagian 2–3 brief ini (tabel jangkar, alasan, berkas yang dibalik dan tidak), cara pakai skrip termasuk `--undo`, uji permanen `pci-orientation.test.ts`, dan catatan bahwa berkas 07L/25R 2024 adalah salinan 2025.

Di bagian **"Tautan dan simpanan yang memakai nomor lama"**, tambahkan:

> - Hal yang sama berlaku setelah pembalikan muatan 2 November: edit `unitScores` untuk 06/24 2026 dan 07L/25R yang sudah dipublikasikan ke Blob kini menempel pada muatan unit seberang. Kalau ada, periksa di halaman Admin.
