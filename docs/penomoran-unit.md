# Penomoran sample unit

Berlaku sejak 21 Oktober 2026.

## Konvensi

| Runway | Jumlah unit (N) | Unit 1 | Unit N |
|---|---|---|---|
| RWY 06/24 | 300 | ujung ambang **06** (barat daya) | ujung ambang 24 (timur laut) |
| RWY 07L/25R | 360 | ujung ambang **07L** (barat) | ujung ambang 25R (timur) |

Alasan: nomor mengikuti arah pelaksanaan survei, yang dimulai dari ujung 06 dan 07L. Nomor unit naik searah survei, jadi sumbu x grafik skid (jarak dari ujung 06 / 07L) dan nomor unit naik bersama.

## Rumus

```
id_baru = N + 1 - id_lama        N = 300 untuk 06/24, N = 360 untuk 07L/25R
```

Rumus ini membalik dirinya sendiri, jadi `id_lama = N + 1 - id_baru`. Tabel lengkapnya ada di [unit-renumbering-map.csv](unit-renumbering-map.csv) (kolom `runway, id_lama, id_baru`).

| Runway | id_lama | id_baru |
|---|---|---|
| 06/24 | 1 | 300 |
| 06/24 | 16 | 285 |
| 06/24 | 300 | 1 |
| 07L/25R | 1 | 360 |
| 07L/25R | 59 | 302 |
| 07L/25R | 360 | 1 |

## Yang dipakai untuk menyandingkan dengan sumber lain

Berkas Excel/PAVER sumber, workbook Markov, dan lampiran data skripsi tetap memakai **penomoran lama** (unit 1 di ujung 24 dan 25R). Baca nomor unit di web lewat tabel di atas. Nomor acuan di spesifikasi dan brief lama, misalnya unit 16, 221, 258, 265 (RWY 06/24) dan unit 59, 100, 301 (RWY 07L/25R), juga penomoran lama.

## Apa yang berubah dan tidak

Hanya label nomor dan urutan baris/array yang berubah. Geometri, PCI, distress, μ skid (termasuk label lajur Left/Right, yang mengikuti arah kendaraan uji), nilai risiko per lokasi, dan ID internal sumber tidak berubah.

Berkas yang dinomori ulang, semua tahun dan semua runway dalam satu commit:

- `public/data/runway-06-24-units-*.json` dan `runway-07L-25R-units-*.json` (`id`, `properties.square_id`, `properties.sampleUnit`; baris diurutkan naik menurut nomor baru)
- `public/data/skid-*-2026.json` (`units[].unit`, `coverage.first_unit/last_unit`, `unit_numbering`)
- `public/data/skid-*-2026-1m.json` (`unit_bounds.starts_m`, `window_mid_m`, dan nomor unit di `reconciliation.edge_cases`)
- `scripts/skid/skid-unit-stations-2026.json` (tabel batas unit untuk `build-skid-1m.mjs`)

Skripnya: `node scripts/renumber-units.mjs` (hanya memeriksa dan mencetak tabel invarian) atau `--write` (menulis). Arah tiap berkas ditentukan dari geometri, dan berkas yang sudah barat-dulu dilewati, jadi menjalankannya dua kali tidak membalik ulang.

## Stasiun tetap diukur dari ambang 24 / 25R

Medan yang nilainya tidak ikut berubah, supaya satu lokasi tetap punya angka yang sama:

- `station_start_m`, `station_mid_m`, `starts_m`, `window_mid_m`, `last_end_m`, dan `s0_m` di data skid: jarak sepanjang sumbu runway dari tepi luar **ambang 24** (RWY 06/24) atau **25R** (RWY 07L/25R). Itu ujung unit 1 pada penomoran lama. Karena unit 1 sekarang di ujung seberang, nilai ini **menurun** menurut nomor unit. `starts_m` dan `window_mid_m` tetap berindeks nomor unit − 1.
- `stationKm` di tab Risk Management (dihitung di `risk-unit-adapter.ts`): kilometer dari ambang 24 / 25R, dihitung `(unit terbesar − unit) × 0,01`. Sebelum penomoran ulang rumusnya `(unit − 1) × 0,01`, nilai di tiap lokasi sama.

Kalau lebih suka stasiun dihitung dari ujung 06 / 07L (searah nomor unit), itu keputusan terpisah: ubah medan skid dan rumus `stationKm`, dan semua nilai stasiun berubah.

## Rentang zona

- RWY 06/24: ujung = 1–50 dan 251–300, tengah = 51–250. Simetris, tidak berubah.
- RWY 07L/25R: `zoneFor` di `risk-unit-adapter.ts` memakai aturan yang sama dengan 06/24 (1–50 dan 251–N), jadi sebelum penomoran ulang ujung = 1–50 dan 251–360, tengah = 51–250. Dipetakan ke 1–110 dan 311–360 (ujung) dan 111–310 (tengah), sehingga tiap lokasi tetap di zona yang sama. Aturan itu tidak simetris dan tampaknya terbawa dari 06/24; definisinya tidak diubah di sini.

## Tautan dan simpanan yang memakai nomor lama

- Tautan yang pernah dibagikan, misalnya `?tab=skid&rw=07L-25R&unit=301`, kini menunjuk ke lokasi lain.
- Edit skor per unit di Admin (`unitScores`) dan GeoJSON unit yang diunggah (`uploadedUnits`) disimpan di localStorage browser dengan nomor lama. Kalau ada, periksa atau reset.
