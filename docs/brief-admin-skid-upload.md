# Brief implementasi — Upload CSV Skiddometer di Admin (APMS-V3.3)

Versi 1 · 26 Oktober 2026
Repo: APMS-V3.3 (lokal `D:\Skripsi\APMS - Claude Vibe Code\PLAN\APMS-V3.3`)
Fixture uji: `src/lib/__fixtures__/skid/2026_06_05_20_21_06_CGK 06 - 24 1.5 m Left.csv` (sudah ditaruh bersama brief ini)

---

## 0. Ringkasan

Tambahkan tab **Skid Resistance** di halaman admin. Admin menyeret berkas CSV mentah hasil ekspor Moventor Skiddometer, lalu **browser** yang mengubahnya menjadi dua berkas JSON yang sudah dipakai tab Skid Resistance sekarang:

- berkas per sample unit (format `skid-<runway>-2026.json`), dan
- berkas per meter (format `skid-<runway>-2026-1m.json`).

Hasilnya diunggah ke Vercel Blob, dicatat di draf admin sebagai **survei**, dan baru terlihat oleh pengunjung setelah tombol **Publish** yang sudah ada ditekan.

Tab Skid Resistance di halaman utama mendapat **pemilih survei**. Data Juni 2026 yang sekarang ada di `public/data/` tetap jadi survei bawaan (seed).

**Kedudukan metodologis tidak berubah.** Data kekesatan tetap pembanding terpisah. Jangan menyentuh `risk.ts`, `risk-unit.ts`, `risk-unit-adapter.ts`, atau berkas risiko lain.

---

## 1. Ruang lingkup

**Termasuk**

1. Tab admin "Skid Resistance": pilih/buat survei, unggah banyak CSV sekaligus, pratinjau per berkas, proses, simpan ke draf.
2. Modul konversi murni `src/lib/skid-import.ts` (tanpa React, tanpa `ol`, bisa diuji dengan `node --test`).
3. Satu Vercel Function baru `api/skid-files.ts` untuk izin unggah berkas skid ke Blob.
4. Medan baru `skidSurveys` di `DataOverrides` (manifest survei, ikut draf dan Publish yang sudah ada).
5. Pemilih survei di tab Skid Resistance; `useSkidData` dan `useSkidTrace` tidak lagi memakai `2026` tertulis mati.
6. Dukungan lajur sebagian (1 sampai 8 lajur per runway).
7. Uji otomatis (§10).

**Tidak termasuk**

- Mengubah batas sample unit. Konversi selalu memakai batas unit 2026 (§5.4).
- Uji pada arah 24 / 25R. CSV dengan `RUNWAY DIRECTION` 24 atau 25R ditolak dengan pesan jelas (§6).
- Data 95 km/j dan ambang 95 km/j.
- Mengedit nilai μ per baris lewat admin.
- Membuka berkas `.zip` di browser. Admin mengekstrak zip dulu di Windows.
- Menghapus berkas Blob yang tidak lagi dirujuk (§12).

---

## 2. Keadaan kode sekarang — baca sebelum mulai

| Hal | Di mana | Catatan |
|---|---|---|
| Data per unit 2026 | `public/data/skid-06-24-2026.json`, `skid-07L-25R-2026.json` | Dibuat pipeline Python di luar repo. Medan `lanes[].s0_m` berasal dari sana. |
| Data per meter 2026 | `public/data/skid-*-2026-1m.json` | Dibuat `scripts/skid/build-skid-1m.mjs`, yang mencocokkan ulang setiap angka dengan berkas per unit. |
| Aturan stasiun dan batas unit | `scripts/skid/skid-unit-stations-2026.json` | `starts_m`, `last_end_m`, `window_mid_m` presisi penuh, plus teks aturannya. |
| Tipe dan skema | `src/types/skid.ts`, `src/lib/skid-schema.ts` | Skema zod dianotasi dengan tipe, jadi `tsc` protes kalau keduanya tidak cocok. |
| Pemuatan data | `src/hooks/useSkidData.ts`, `src/hooks/useSkidTrace.ts` | URL `/data/skid-${id}-2026.json` tertulis mati. |
| Draf dan Publish | `src/lib/data-store.tsx`, `src/lib/data-overrides.ts`, `src/lib/published-overrides.ts`, `src/components/admin/PublishBar.tsx` | Draf di localStorage; publish mengunggah **satu** berkas `apms/<env>/overrides.json`. |
| Izin unggah Blob | `api/overrides.ts` | Hanya menerima pathname `apms/<env>/overrides.json` persis. Cek sesi admin disalin dari `api/auth.ts`. |
| Halaman admin | `src/pages/Admin.tsx` | Tab `pci` dan `risk`. `PublishBar` dan `YearManager` tampil di atas semua tab. |
| Penomoran unit | `docs/penomoran-unit.md` | Unit 1 di ujung 06 / 07L. Stasiun diukur dari ambang 24 / 25R, jadi **menurun** menurut nomor unit. |

Dua fakta yang menentukan rancangan:

1. **Pengunjung menunggu `overrides.json` selesai dimuat sebelum aplikasi tampil** (`data-store.tsx`, sekitar baris 515). Satu survei skid dua runway sekitar 1,2 MB JSON. Data sebesar itu **tidak boleh** masuk `overrides.json`. Yang masuk hanya manifest kecil berisi URL (§7).
2. Draf admin disimpan di localStorage (batas sekitar 5 MB, sudah dipakai data lain). Karena itu berkas JSON skid juga tidak boleh disimpan di draf.

---

## 3. Format CSV Moventor (dari berkas fixture)

```
"MOVENTOR SKIDDOMETER MEASURING REPORT"

MEASUREMENT
DATE,2026-06-05
TIME,17:21:06
"TIME ZONE",UTC+00:00
"RESOLUTION (m)",1
WETTING,On
"AMBIENT TEMPERATURE (C)",28.4

SURFACE
NAME,"CGK 06 - 24"
"RUNWAY DIRECTION",06
LENGTH,2400

STATISTICS
FRICTION,0.70579708333333
"SPEED (km/h)",65.1324
"SURFACE TEMPERATURE (C)",NAN

DISTANCE,FRICTION,"SPEED (km/h)","SURFACE TEMPERATURE (C)",TIME,POSITION,MARKER
1,0.8695,66.06,NAN,17:22:33,"-6.11287, 106.6471025",
...
2400,0.9125,65.628,NAN,17:24:45,"-6.1048592385041, 106.66717411249",


"END OF DATA"
```

Hal yang harus ditangani:

- **Lajur ukur tidak ada di isi berkas.** Offset dan sisi hanya ada di nama berkas: `... 1.5 m Left.csv`. Kiri/kanan relatif terhadap arah kendaraan uji (`RUNWAY DIRECTION`).
- **Jam di nama berkas bukan UTC.** Nama `2026_06_05_20_21_06_...` lebih cepat 3 jam dari header (`17:21:06`, `UTC+00:00`). Waktu survei **selalu** diambil dari header `DATE` + `TIME` + `TIME ZONE`. Dalam WIB (UTC+7), berkas ini tercatat **6 Juni 2026 pukul 00:21**, bukan 5 Juni.
- `POSITION` berisi `"lat, lon"` dalam satu sel bertanda kutip. Lajur tanpa GPS punya sel kosong atau `0, 0`.
- `SURFACE TEMPERATURE` bernilai `NAN` di semua baris.
- `FRICTION` bisa `NAN`. Baris itu tetap dihitung di `n`, tetapi tidak ikut rata-rata.
- Banyak baris berulang persis (alat menahan nilai sebelumnya). Di fixture, 456 baris punya `FRICTION` **dan** `SPEED` sama dengan baris sebelumnya. Ini dicatat sebagai `held_rows`, bukan dibuang.
- Rata-rata `FRICTION` seluruh baris **sama persis** dengan `STATISTICS → FRICTION` di header (0,70579708333333). Dipakai sebagai cek keutuhan berkas.
- Berkas yang pernah dibuka lalu disimpan ulang di Excel berlocale Indonesia bisa berubah jadi pemisah `;` dengan koma desimal. Parser menerimanya, tetapi memberi peringatan (§6).
- **Nama berkas bisa tersanitasi** saat berpindah lewat aplikasi lain: `1.5 m Left` menjadi `1_5_m_Left`. Fungsi `laneFromName` yang ada sekarang membaca nama itu sebagai `L5.0`, dan `6_0_m_Left` sebagai `L0.0`. Ini harus diperbaiki (§5.2, uji T2).

---

## 4. Alur di halaman admin

### 4.1 Tab baru

Di `src/pages/Admin.tsx`:

```ts
type AdminTab = "pci" | "risk" | "skid";
// ADMIN_TABS: { id: "skid", label: "Skid Resistance", shortLabel: "Skid" }
```

- `YearManager` **tidak** ditampilkan saat tab `skid` aktif. Tahun PCI tidak ada hubungannya dengan survei skid.
- `PublishBar` tetap tampil di semua tab.
- Judul header "Admin — PCI Survey Data" diganti "Admin — Survey Data".
- Isi tab: komponen baru `src/components/admin/SkidImportPanel.tsx` dan `SkidSurveyList.tsx`.

### 4.2 Daftar survei (`SkidSurveyList`)

Tabel survei yang ada: seed Juni 2026 dan semua survei di draf. Kolom: label, id, runway yang ada beserta tanggal WIB-nya, jumlah lajur terukur per runway, sumber ("Bawaan" atau "Unggahan admin").

- Survei unggahan bisa dihapus (konfirmasi `AlertDialog`). Menghapus hanya membuang entri manifest dari draf.
- Survei bawaan tidak bisa dihapus. Runway-nya bisa **digantikan** lewat impor ke id `2026-06` (§7.3).

### 4.3 Langkah impor (`SkidImportPanel`)

1. **Unggah berkas.** `<input type="file" accept=".csv" multiple>` plus area seret-lepas. Batas 16 berkas per sekali proses, 5 MB per berkas.
2. **Pratinjau per berkas.** Tabel satu baris per CSV:

   | Kolom | Isi |
   |---|---|
   | Berkas | nama asli |
   | Runway | hasil deteksi; dropdown untuk mengoreksi |
   | Lajur | hasil deteksi; dropdown 8 kode lajur untuk mengoreksi |
   | Mulai (WIB) | dari header |
   | Baris | jumlah baris data |
   | μ rata-rata | 4 desimal |
   | Kecepatan rata-rata | 2 desimal, plus jumlah baris di luar 65 ± 5 km/j |
   | GPS | jumlah baris ber-POSITION |
   | s0 (m) | hasil otomatis (§5.3), bisa diubah manual |
   | Cek lateral GPS | sisa lateral (m) terhadap pola lajur lain |
   | Status | OK / peringatan (kuning) / galat (merah), dengan daftar pesan |

3. **Survei tujuan.** Id dan label diisi otomatis dari tanggal WIB berkas paling awal: id `YYYY-MM`, label `Mmm YYYY` (contoh fixture: `2026-06`, "Jun 2026"). Admin bisa mengganti label, atau memilih survei lain yang sudah ada.
4. **Proses.** Tombol aktif hanya kalau tidak ada galat. Hasilnya ringkasan per runway:
   - cakupan unit (`coverage`);
   - jumlah unit per kelas, memakai `summarize()` dari `src/lib/skid.ts` yang sudah ada;
   - unit dengan μ penentu terendah;
   - jika menggantikan runway yang sudah ada di survei itu: tabel selisih (jumlah unit yang kelasnya berubah, selisih `s0` per lajur).
5. **Simpan ke draf.** Mengunggah berkas ke Blob (§7) lalu menambah entri manifest ke draf. Pesan sukses: "Tersimpan sebagai draf. Tekan Publish supaya pengunjung melihatnya."

Perhitungan berjalan di main thread; 16 berkas × 3.000 baris selesai dalam hitungan milidetik, tidak perlu Web Worker.

### 4.4 Lajur sebagian

- Satu runway boleh berisi 1 sampai 8 lajur.
- Lajur yang tidak diunggah: `mu_10m = null`, `n = 0`, `mu_152m = null` di semua unit. Tampil abu-abu "Not measured" di heatmap dan peta.
- Peringatan kuning di pratinjau, contoh: "RWY 06/24: hanya 2 dari 8 lajur (R3.0, R6.0). Nilai penentu (governing) hanya dari lajur terukur."
- `s0` lajur tanpa GPS diambil dari median `s0` lajur ber-GPS di runway yang sama. Kalau tidak ada satu pun lajur ber-GPS, impor runway itu **ditolak**.

**Catatan perubahan dari pratinjau keputusan:** di berkas per meter, `lanes[]` **tetap 8 entri** (lajur tak terukur berisi larik kosong dan `measured: false`), bukan hanya lajur terukur. Alasannya, `SkidHeatmap.tsx` membaca lajur menurut indeks baris (baris 200 dan 223) dan `SkidRuns.tsx` memakai `.find(...)!` (baris 46–47). Delapan entri tetap membuat indeks itu aman.

---

## 5. Aturan konversi — `src/lib/skid-import.ts`

Modul murni TypeScript. Impor JSON dengan `import ... with { type: "json" }` atau terima datanya sebagai argumen, supaya bisa dijalankan di browser dan di `node --test`.

**Aturan hitung harus identik dengan `scripts/skid/build-skid-1m.mjs`.** Jangan mengubah skrip itu selain baris yang disebut di §11 langkah 1. Skrip itu menjadi pembanding (oracle) di uji T3 dan T5.

### 5.1 Parser

Porting `parseMoventorCsv`, `splitCsvLine`, `toNumber`, dan `metaValue` dari `build-skid-1m.mjs` (baris 55–148), dengan dua perbaikan:

- **Nama berkas tersanitasi**: lihat §5.2.
- **POSITION di berkas `;`**: Excel menyimpan sel POSITION sebagai teks, jadi isinya tetap `-6.11287, 106.6471025` (titik desimal, koma pemisah) walaupun kolom angka lain sudah berkoma desimal. Kode sekarang (baris 124) memecah POSITION dengan `/[;\s]+/` lalu mengganti koma jadi titik, sehingga `-6.11287,` gagal terbaca dan GPS hilang. Pecah POSITION dengan pola `^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$` yang menerima kedua bentuk.

Kembalian ditambah:

```ts
interface ParsedMoventor {
  meta: { section: string; key: string; value: string }[];
  rows: { d: number; mu: number | null; speed: number | null; time: string; lat: number | null; lon: number | null; marker: string }[];
  endOfData: boolean;
  delimiter: "," | ";";
  startUtc: string;          // ISO, dari DATE + TIME + TIME ZONE header
  runwayDirection: string | null;
  surfaceName: string | null;
  resolutionM: number | null;
  wetting: string | null;
}
```

`startUtc`: gabungkan `DATE` dan `TIME`, kurangi offset `TIME ZONE` (`UTC+HH:MM`). Untuk fixture: `2026-06-05T17:21:06Z`.

### 5.2 Deteksi runway dan lajur

Porting `runwayFromName` dan `laneFromName`, dengan perbaikan:

```ts
// Sebelum dicocokkan: ganti "_" dengan spasi, lalu satukan "<angka> <angka> m" menjadi "<angka>.<angka> m"
//   "1 5 m Left"  -> "1.5 m Left"
//   "6 0 m Left"  -> "6.0 m Left"
// Hasil harus salah satu dari LANE_ORDER. Selain itu kembalikan null (admin memilih manual).
```

Cek silang dengan header (galat kalau bertentangan):

- `RUNWAY DIRECTION` 06 → runway `06-24`; 07L → `07L-25R`.
- `RUNWAY DIRECTION` 24 atau 25R → galat "Arah uji 24/25R belum didukung" (§1).
- `SURFACE NAME` yang memuat `06 - 24` atau `07L-25R` harus sama dengan runway hasil deteksi nama berkas.

### 5.3 s0 lajur (stasiun pada DISTANCE = 0)

Sama dengan `makeAxis` di `build-skid-1m.mjs` (baris 210–224) dan cek `s0_from_gps_m` (baris 424–431):

```
sumbu      = garis lurus dari centroid unit di stasiun terkecil ke centroid unit di stasiun terbesar
             (centroid_lonlat dan station_mid_m dari berkas per unit seed runway itu)
stasiun_i  = proyeksi titik GPS baris i ke sumbu, dalam meter
s0_auto    = round( median( stasiun_i + DISTANCE_i ), 1 )      // hanya baris ber-GPS, minimal 10 baris
s0 lajur tanpa GPS = round( median( s0 lajur ber-GPS ), 1 )
```

Fixture: median 2705,619 → `s0_auto = 2705.6`.

**Selisih dengan data 2026 yang sudah ada.** `s0_m` di berkas seed berasal dari pipeline Python yang sumbunya sedikit berbeda. Rumus di atas memberi nilai sekitar 0,1 m lebih kecil di RWY 06/24 dan sekitar 0,45 m lebih kecil di RWY 07L/25R (dari laporan `build-skid-1m-report-2026-10-15.txt`). Pergeseran ini jauh di bawah ketidakpastian posisi data (± 1 unit = 10 m), tetapi cukup untuk memindahkan satu bacaan di batas unit. Di fixture, `s0 = 2705.6` (bukan 2705.7) hanya mengubah `n` di unit 66 (10 → 9) dan unit 107 (9 → 10).

Karena itu kolom s0 di pratinjau bisa diubah manual. Saat mengganti runway yang sudah ada, nilai awal kolom s0 = `s0_m` survei lama, dengan tombol "Hitung dari GPS". Medan `s0_source` diisi `"median proyeksi GPS"`, `"median s0 lajur lain (tanpa GPS)"`, atau `"diisi manual"`.

Cek kewajaran GPS (galat kalau gagal):

- kemiringan regresi `(stasiun_i + DISTANCE_i)` terhadap `DISTANCE_i` harus |b| < 0,05. Di fixture b = 0,0003. Uji arah terbalik atau kolom DISTANCE rusak memberi b sekitar 2.
- Sebaran GPS wajar besar: di fixture IQR `stasiun_i + DISTANCE_i` = 10,2 m. Jangan dipakai sebagai galat. Tampilkan saja di tooltip.

### 5.4 Unit, μ 10 m, μ 152 m

Batas unit dibaca dari `skid-unit-stations-2026.json` (dipindah ke `src/config/`, §11 langkah 1). Aturannya sama persis dengan teks `rules` di berkas itu dan kode `build-skid-1m.mjs` baris 285–398:

```
stasiun bacaan = s0_m - DISTANCE
unit k         : starts_m[k-1] <= stasiun < starts_m[k-2]      (unit 1: stasiun < last_end_m)
n              = jumlah baris di unit itu, termasuk FRICTION = NAN
mu_10m         = rata-rata FRICTION non-null di unit itu; null kalau n = 0 atau semua NAN
mu_152m        = rata-rata FRICTION non-null dengan window_mid_m[k-1] - 76.2 <= stasiun < window_mid_m[k-1] + 76.2
                 hanya diisi kalau mu_10m tidak null
Perbandingan stasiun dalam bilangan bulat 0,1 mm: Math.round(nilai * 10000)
```

Medan per unit lainnya:

- `station_start_m`, `station_mid_m`, `centroid_lonlat`: **disalin** dari berkas per unit seed runway yang sama. Geometri unit tidak berubah antarsurvei. Ini menjamin uji C di `skid.test.ts` tetap lulus. Selalu baca dari berkas statis `public/data/skid-<runway>-2026.json`, **bukan** dari versi pengganti di manifest (§7.3), supaya acuan geometri tidak ikut berubah setiap kali seed digantikan.
- `mu_10m`, `mu_152m`: dibulatkan 4 desimal.
- `lanes_measured`: jumlah lajur dengan `n > 0` di unit itu.
- `governing_10m`, `governing_152m`: lajur dengan μ terkecil di antara lajur ber-nilai. Kalau seri, ambil yang pertama menurut `LANE_ORDER`. `null` kalau tidak ada.
- `coverage`: unit pertama, terakhir, dan jumlah unit dengan `lanes_measured > 0`; `n_units_total` = 300 atau 360.

### 5.5 Medan tingkat runway (berkas per unit)

| Medan | Nilai |
|---|---|
| `schema_version` | 1 |
| `runway` | `06-24` / `07L-25R` |
| `unit_numbering`, `thresholds`, `basis`, `offset_sign`, `position_uncertainty_units`, `geometry_source` | disalin dari berkas seed runway yang sama |
| `survey.device` | `"Moventor Skiddometer"` |
| `survey.speed_kmh` | `SKID_SPEED.target` (65) |
| `survey.wetting` | dari header lajur pertama |
| `survey.direction` | `"06"` / `"07L"` |
| `survey.start_utc` | `startUtc` paling awal di antara lajur |
| `survey.end_utc` | paling akhir di antara lajur dari `DATE` + `TIME` baris terakhir; tambah 1 hari kalau jam baris terakhir lebih kecil dari jam header |
| `survey.start_wib`, `end_wib` | `"YYYY-MM-DD HH:mm"`, UTC + 7 jam |
| `survey.measured_length_m` | jumlah baris terbanyak di antara lajur |
| `lanes[]` | 8 entri urut `LANE_ORDER`: `code`, `side`, `offset_m`, `gps`, `s0_m`, `s0_source`, `record_start_utc`, `mean_mu_run` (4 desimal), `mean_speed_kmh` (2 desimal), `file`, `measured` |
| `source` (baru, opsional) | `{ kind: "admin-import", imported_at, app_version? }` |

### 5.6 Berkas per meter

Sama dengan objek `output` di `build-skid-1m.mjs` baris 492–514, dengan perbedaan:

- `generated_by`: `"src/lib/skid-import.ts (admin)"`.
- `source_units_file`: nama berkas per unit pasangannya.
- `lanes[]` tetap 8 entri. Lajur tak terukur: `measured: false`, `file: ""`, `s0_m: null`, `gps: false`, `length_m: 0`, `mu: []`, `speed_kmh: []`, `markers: []`, `stats` berisi 0/null, `header` berisi null.
- `reconciliation`: diisi dari pemeriksaan diri sendiri. Setelah kedua berkas dibuat, hitung ulang `n`, `mu_10m`, `mu_152m` dari berkas per meter dengan fungsi yang sama, bandingkan dengan berkas per unit, dan isi jumlahnya. Kalau ada yang tidak cocok, impor gagal (ini tanda bug, bukan masalah data).

---

## 6. Validasi

**Galat (memblokir Proses)**

| Kode | Kondisi | Pesan |
|---|---|---|
| `no-header` | baris `DISTANCE,FRICTION,...` tidak ada | "Bukan ekspor Moventor: baris judul DISTANCE/FRICTION tidak ditemukan." |
| `distance-gap` | DISTANCE bukan 1, 2, 3, … | "DISTANCE tidak berurutan mulai baris N." |
| `resolution` | `RESOLUTION (m)` ≠ 1 | "Resolusi N m; hanya 1 m yang didukung." |
| `runway-unknown` | runway tidak terdeteksi dan belum dipilih | "Runway tidak terbaca dari nama berkas. Pilih manual." |
| `lane-unknown` | lajur tidak terdeteksi dan belum dipilih | "Lajur tidak terbaca dari nama berkas. Pilih manual." |
| `runway-mismatch` | nama berkas, `SURFACE NAME`, dan `RUNWAY DIRECTION` tidak sepakat | "Nama berkas menyebut X, header menyebut Y." |
| `reverse-direction` | `RUNWAY DIRECTION` 24 atau 25R | "Arah uji 24/25R belum didukung." |
| `duplicate-lane` | dua berkas untuk runway dan lajur yang sama | "R3.0 RWY 06/24 ada di dua berkas: A, B." |
| `no-gps-runway` | runway tanpa satu pun lajur ber-GPS (≥ 10 baris) | "Tidak ada lajur ber-GPS; posisi tidak bisa ditentukan." |
| `gps-slope` | |b| ≥ 0,05 (§5.3) | "Jarak (DISTANCE) tidak cocok dengan GPS." |
| `empty` | 0 baris data | "Berkas tidak berisi data." |

**Peringatan (Proses tetap boleh)**

| Kode | Kondisi |
|---|---|
| `no-end-marker` | tidak ada baris `END OF DATA` |
| `length-mismatch` | `LENGTH` header ≠ jumlah baris |
| `stat-mismatch` | rata-rata μ baris berbeda dari `STATISTICS → FRICTION` lebih dari setengah digit terakhir header |
| `speed` | ada baris dengan |SPEED − 65| > 5 km/j (tampilkan jumlahnya) |
| `wetting-off` | `WETTING` bukan `On` (uji kering tidak sebanding dengan ambang FAA) |
| `semicolon` | pemisah `;` (berkas kemungkinan pernah disimpan ulang di Excel) |
| `lateral` | sisa lateral GPS > 1,5 m dari pola lajur lain, aturan `build-skid-1m.mjs` baris 481–490 ("periksa label lajur") |
| `partial-lanes` | kurang dari 8 lajur |
| `lane-length` | jumlah baris antarlajur satu runway berbeda |
| `span` | selisih waktu mulai lajur pertama dan terakhir satu runway > 12 jam |
| `replace` | runway sudah ada di survei tujuan; impor akan menggantikannya |

---

## 7. Penyimpanan: Blob dan manifest

### 7.1 Berkas di Blob

Unggah pada langkah "Simpan ke draf", sebelum Publish. Pathname berbasis isi (hash), jadi tidak pernah menimpa berkas yang sedang dipakai pengunjung:

```
apms/<env>/skid/<surveyId>/units-<runway>-<hash12>.json
apms/<env>/skid/<surveyId>/trace-<runway>-<hash12>.json
apms/<env>/skid/<surveyId>/raw/<hash12>-<nama-csv-aman>.csv
```

- `<hash12>`: 12 karakter hex pertama SHA-256 isi berkas (`crypto.subtle.digest`).
- `<nama-csv-aman>`: nama asli, karakter selain `[A-Za-z0-9._-]` diganti `-`, maksimal 80 karakter.
- CSV mentah ikut disimpan supaya konversi bisa diulang dan diaudit.
- Ukuran kira-kira per survei dua runway: JSON 1,2 MB, CSV 16 × 160–200 KB.

### 7.2 Function `api/skid-files.ts`

Salin pola `api/overrides.ts`, termasuk cek sesi admin yang disalin dari `api/auth.ts` (nama cookie dan skema tanda tangan harus sama). Hanya `POST` (`handleUploadPresigned`). Perbedaannya di `getSignedToken`:

```ts
// Ekspor sebagai fungsi murni supaya bisa diuji (uji T9).
export function skidUploadRule(pathname: string, env: string):
  { contentType: "application/json" | "text/csv"; maxBytes: number } | null {
  const base = `apms/${env}/skid/`;
  const json = new RegExp(`^${base}[a-z0-9-]{1,40}/(units|trace)-(06-24|07L-25R)-[0-9a-f]{12}\\.json$`);
  const csv  = new RegExp(`^${base}[a-z0-9-]{1,40}/raw/[0-9a-f]{12}-[A-Za-z0-9._-]{1,80}\\.csv$`);
  if (json.test(pathname)) return { contentType: "application/json", maxBytes: 5 * 1024 * 1024 };
  if (csv.test(pathname))  return { contentType: "text/csv",         maxBytes: 5 * 1024 * 1024 };
  return null;
}
```

Tanpa sesi admin yang sah atau pathname yang tidak cocok: tolak. `addRandomSuffix: false`, `allowOverwrite: true` (isi dengan nama yang sama pasti identik karena nama memuat hash).

Di sisi browser: fungsi `uploadSkidFile(pathname, blob, contentType)` di `src/lib/skid-upload.ts`, memakai `uploadPresigned` seperti `publishOverrides`, dengan `handleUploadUrl: "/api/skid-files"`.

### 7.3 Manifest di `DataOverrides`

Di `src/lib/data-overrides.ts`:

```ts
export interface SkidSurveyRunwayEntry {
  unitsUrl: string;
  traceUrl: string;
  rawCsv: { name: string; url: string; sha256: string }[];
  startWib: string;                  // "YYYY-MM-DD HH:mm"
  lanes: LaneCode[];                 // lajur terukur
  s0Mode: "gps" | "manual" | "mixed";
  importedAt: string;                // ISO
}

export interface SkidSurveyEntry {
  id: string;                        // "2026-06", "2027-06", ...
  label: string;                     // "Jun 2026"
  runways: Partial<Record<RunwayId, SkidSurveyRunwayEntry>>;
}

// di DataOverrides:
skidSurveys?: Record<string, SkidSurveyEntry>;
```

- Tambahkan ke whitelist `normalizeOverrides`. `emptyOverrides()` tidak perlu diubah (medan opsional).
- Tambahkan aksi di `data-store.tsx`: `upsertSkidSurveyRunway(surveyId, label, runway, entry)` dan `removeSkidSurvey(surveyId)`. Keduanya mengubah draf, sama seperti aksi lain.
- **Seed** adalah survei virtual `{ id: "2026-06", label: "Jun 2026" }` dengan URL `/data/skid-<runway>-2026.json` dan `/data/skid-<runway>-2026-1m.json`. Seed tidak disimpan di manifest.
- Kalau manifest punya id `2026-06`, runway di manifest **menggantikan** runway seed yang sama. Runway lain tetap dari seed.
- Menghapus survei atau mengganti runway hanya mengubah manifest. Berkas Blob lama tetap ada (§12).

---

## 8. Perubahan di tab Skid Resistance (halaman utama)

1. Hook baru `useSkidSurveys()` di `src/hooks/useSkidSurveys.ts`: gabungan seed + `overrides.skidSurveys`, diurutkan menurut `startWib` terbaru. Tiap entri berisi id, label, dan URL per runway yang ada.
2. `useSkidData(surveyId)`: muat berkas per unit tiap runway yang ada di survei itu. Kunci cache `useCachedLoad` = `skid-units:${surveyId}:${url}`, supaya draf dan versi publish tidak tertukar. Poligon unit tetap dari `SEED_SAMPLE_UNIT_SOURCES["2026"]`.
3. `useSkidTrace(surveyId, runway)`: idem untuk berkas per meter, kunci `skid-trace:${surveyId}:${runway}:${url}`.
4. Pemilih survei (shadcn `Select`) di samping pemilih runway di `SkidTab.tsx`. Default: survei terbaru. Kalau hanya ada satu survei, tampilkan sebagai teks, bukan dropdown.
5. URL: tambahkan kunci `survey` ke `SKID_URL_KEYS` dan `parseSkidUrl`/serializer di `src/lib/skid-url.ts`. Id yang tidak dikenal diabaikan (jatuh ke default).
6. Runway yang tidak ada di survei terpilih: tampilkan keadaan kosong "RWY 07L/25R tidak diukur pada survei ini" (pakai `components/ui/empty.tsx`), bukan galat.
7. `SkidAbout.tsx` baris 56: ganti "Data cover June 2026 only" dengan teks dari survei terpilih (pakai `surveyDate()` di `skid-ui.ts`).
8. Lajur `measured: false` harus dilewati atau ditampilkan "Not measured" di titik-titik berikut:
   - `SkidHeatmap.tsx` baris 59, 81, 200, 223
   - `SkidRuns.tsx` baris 46–47 (hilangkan `!`)
   - `SkidProfile.tsx` baris 82–83 dan chip lajur (nonaktifkan lajur tak terukur)
   - `SkidProfileChart.tsx` baris 160–161 (`Math.min`/`Math.max` atas larik kosong)
   - `SkidUnitPanel.tsx` baris 29, 82, 222, 236
   - `SkidMap.tsx` baris 251, 278
   - `src/lib/skid-export.ts` baris 17
   - `src/lib/skid-trace.ts`: semua fungsi yang menerima satu lajur harus aman untuk `mu: []`

---

## 9. Skema

`src/types/skid.ts` dan `src/lib/skid-schema.ts` (ubah keduanya bersamaan):

- `SkidLaneMeta`: tambah `measured?: boolean` (tidak ada = `true`, jadi berkas seed tetap valid). `s0_m`, `record_start_utc`, `mean_mu_run`, `mean_speed_kmh` boleh `null` **hanya** kalau `measured === false` (`superRefine`).
- `SkidLaneTrace`: tambah `measured?: boolean`. Kalau `false`: `mu` dan `speed_kmh` kosong, `length_m = 0`, `s0_m` boleh `null`. `superRefine` yang memeriksa `mu.length === length_m` tetap berlaku.
- `SkidRunwayData`: tambah `source?: { kind: "seed" | "admin-import"; imported_at?: string }`.
- `schema_version` tetap 1. Semua medan baru opsional, jadi berkas seed tidak perlu diubah.

---

## 10. Uji otomatis

Tambahkan berkas uji baru ke skrip `test` di `package.json`. Semua uji lama harus tetap lulus, begitu juga `npm run build` (`tsc -b && vite build`) dan `npm run lint`.

Fixture: `src/lib/__fixtures__/skid/2026_06_05_20_21_06_CGK 06 - 24 1.5 m Left.csv` (162.400 byte, lajur L1.5 RWY 06/24).

**T1 — Parser** (`skid-import.test.ts`)
- meta: `DATE` 2026-06-05, `TIME` 17:21:06, `TIME ZONE` UTC+00:00, `RESOLUTION (m)` 1, `WETTING` On, `NAME` CGK 06 - 24, `RUNWAY DIRECTION` 06, `LENGTH` 2400
- 2400 baris, DISTANCE 1..2400, `endOfData = true`, delimiter `,`
- rata-rata FRICTION = 0,70579708333333 (selisih < 1e-12), min 0,2785, max 0,9635, tidak ada NAN
- kecepatan rata-rata 65,1324, min 62,028, max 67,86, 0 baris di luar 65 ± 5
- 2400 baris ber-GPS, `held_rows` = 456
- `startUtc` = `2026-06-05T17:21:06Z`, `start_wib` = `2026-06-06 00:21`

**T2 — Deteksi nama berkas**

| Nama | Runway | Lajur |
|---|---|---|
| `2026_06_05_20_21_06_CGK 06 - 24 1.5 m Left.csv` | 06-24 | L1.5 |
| `2026_06_05_20_21_06_CGK_06_-_24_1_5_m_Left.csv` | 06-24 | L1.5 (sekarang salah terbaca L5.0) |
| `2026_06_14_21_01_33_CGK 07L-25R 6.0 m Left.csv` | 07L-25R | L6.0 |
| `2026_06_14_21_01_33_CGK_07L-25R_6_0_m_Left.csv` | 07L-25R | L6.0 (sekarang salah terbaca L0.0) |
| `CGK 06 - 24 3,0 m Right.csv` | 06-24 | R3.0 |
| `CGK 06 - 24 2.0 m Left.csv` | 06-24 | null (bukan kode lajur yang sah) |

**T3 — Reproduksi data seed, s0 dikunci** — fixture, `s0 = 2705.7` (nilai seed). Lajur L1.5 hasil impor harus sama dengan lajur L1.5 di `public/data/skid-06-24-2026.json` untuk **300 dari 300 unit** (`n` sama persis; `mu_10m` dan `mu_152m` selisih ≤ 0,00005). Angka penanda:

| Unit | n | mu_10m | mu_152m |
|---|---|---|---|
| 30 (pertama) | 7 | 0,8865 | 0,8723 |
| 100 | 10 | 0,7677 | 0,7510 |
| 150 | 10 | 0,7904 | 0,7815 |
| 200 | 10 | 0,6937 | 0,6769 |
| 270 (terakhir) | 4 | 0,9250 | 0,8979 |

Cakupan lajur ini: unit 30–270 (241 unit), jumlah `n` = 2400.

**T4 — s0 otomatis** — fixture tanpa s0 manual: `s0_auto = 2705.6` (median 2705,619), `s0_source = "median proyeksi GPS"`, kemiringan |b| < 0,05. Dibanding T3, hanya unit 66 (`n` 10 → 9) dan unit 107 (`n` 9 → 10) yang berubah.

**T5 — Reproduksi penuh (lokal saja)** — kalau folder `data-raw/skid-2026/` berisi 16 CSV asli ada: impor semua dengan `s0` dikunci ke nilai seed, lalu bandingkan dengan keempat berkas seed. Target: 2400/2400 dan 2880/2880 pasangan unit-lajur cocok (toleransi 0,00005), larik `mu` dan `speed_kmh` per meter identik, `governing_*` dan `coverage` identik. Pengecualian satu-satunya: pasangan unit-lajur yang tercantum di `reconciliation.edge_cases` berkas per meter seed (bacaan tepat di tepi jendela 152 m, dibulatkan berbeda oleh pipeline Python) boleh berbeda pada `mu_152m`; laporkan selisihnya. Kalau folder tidak ada, `t.skip("data-raw/skid-2026 tidak ada")`.

**T6 — Lajur sebagian** — impor fixture saja (1 lajur): 8 entri `lanes`, 7 dengan `measured: false`; `lanes_measured` = 1 di unit 30–270 dan 0 di luar itu; `governing_10m` = `{ lane: "L1.5", mu: mu_10m L1.5 }` di unit 30–270; kedua berkas lolos `SkidRunwaySchema` dan `SkidTraceSchema`.

**T7 — Galat dan peringatan** (ubah teks fixture di memori)
- dua berkas L1.5 RWY 06/24 → `duplicate-lane`
- hapus baris DISTANCE 500 → `distance-gap`
- kosongkan semua POSITION, impor sendirian → `no-gps-runway`
- ganti `"RUNWAY DIRECTION",06` jadi `24` → `reverse-direction`
- ubah ke pemisah `;` dan koma desimal pada DISTANCE, FRICTION, SPEED (POSITION dibiarkan teks bertitik seperti aslinya) → angka dan 2400 baris GPS identik dengan T1, plus peringatan `semicolon`
- hapus `"END OF DATA"` → peringatan `no-end-marker`
- ubah satu nilai FRICTION → peringatan `stat-mismatch`

**T8 — Waktu** — `end_utc` lintas tengah malam: header `TIME 23:59:00`, baris terakhir `00:01:30` → `end_utc` di hari berikutnya.

**T9 — Aturan pathname** — `skidUploadRule`: menerima `apms/production/skid/2027-06/units-06-24-0123456789ab.json` dan `.../raw/0123456789ab-CGK-06---24-1.5-m-Left.csv`; menolak `apms/production/overrides.json`, `../`, `env` lain, hash bukan 12 hex, runway lain, ekstensi lain.

**T10 — Manifest** — `normalizeOverrides` mempertahankan `skidSurveys`; daftar survei = seed + manifest; entri `2026-06` di manifest menggantikan runway seed yang sama saja.

---

## 11. Urutan kerja

1. Pindahkan `scripts/skid/skid-unit-stations-2026.json` ke `src/config/skid-unit-stations-2026.json`. Di `build-skid-1m.mjs`, ubah **hanya** default `--stations` (baris 521) ke lokasi baru. Jalankan `npm test`.
2. `src/lib/skid-import.ts` + uji T1–T8. Belum ada UI.
3. Skema dan tipe (§9). Pastikan berkas seed tetap lolos dan uji lama tetap hijau.
4. `api/skid-files.ts` + `src/lib/skid-upload.ts` + uji T9.
5. Manifest di `data-overrides.ts` dan aksi di `data-store.tsx` + uji T10.
6. Tab admin (§4).
7. Tab Skid Resistance: pemilih survei, hook, URL, dan penanganan lajur tak terukur (§8).
8. Uji manual dengan `vercel dev`: impor fixture ke survei baru `2099-01` (label "Uji"), Simpan ke draf, buka tab Skid di jendela yang sama (draf terlihat), Publish, buka di jendela privat (versi publish terlihat), hapus survei, Publish lagi.
9. Kalau 16 CSV asli tersedia di `data-raw/skid-2026/`, jalankan T5 dan laporkan hasilnya.

Kalau ada uji yang gagal, **berhenti dan laporkan**. Jangan mengubah aturan hitung supaya uji lulus.

---

## 12. Batasan yang dicatat (untuk naskah dan pengembangan berikutnya)

- **s0 survei baru dan survei 2026 dihitung dengan cara berbeda.** Selisihnya sekitar 0,1 m (06/24) dan 0,45 m (07L/25R), jauh di bawah ketidakpastian posisi ± 1 unit. Kalau dua survei dibandingkan per unit, selisih ini perlu disebut.
- **Batas unit tetap batas 2026.** Kalau segmentasi sample unit berubah, `skid-unit-stations-*.json` dan berkas seed perlu dibuat ulang.
- **Berkas Blob tidak pernah dihapus otomatis.** Survei yang dihapus atau digantikan meninggalkan berkas lama. Volumenya kecil (sekitar 4 MB per survei). Pembersihan bisa dibuat nanti.
- **Store Blob bersifat publik.** Siapa pun yang tahu URL bisa mengunduh JSON dan CSV, sama seperti `overrides.json` sekarang.
- Hanya uji 65 km/j dan arah 06 / 07L yang didukung.
