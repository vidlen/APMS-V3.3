# Brief implementasi: Tab Macrotexture dan unggah tekstur makro di Admin (APMS-V3.3)

Versi 1 · 4 November 2026
Repo: APMS-V3.3, dasar commit `63eba0b` (3 Nov 2026 17:37 WIB)
Data: paket MATLAB `D:\Skripsi\Data Macro n Roughness\TEKSTUR_2026`, hasil `hasil\0624\` dan `hasil\07L25R\`
Fixture uji: folder `fixtures/` di samping brief ini (§10.1)

---

## 0. Ringkasan dan kedudukan metodologis

Tekstur makro hasil survei LCMS Juni 2026 untuk **kedua runway** dimasukkan ke web sebagai **tab kelima "Macrotexture"**. Urutan tabnya PCI, Skid, Roughness (BBI), Macrotexture, lalu Risk. Isinya ringkasan, tabel vonis FAA per zona, peta per sample unit, grafik sepanjang runway, profil melintang, panel unit, dan panel About.

Pekerjaan dibagi dua fase, dan **keduanya dikerjakan dalam brief ini**.

- **Fase 1, seed.** Skrip Node mengubah keluaran paket `TEKSTUR_2026` menjadi satu JSON per runway di `public/data/`. Kedua JSON di-commit. Polanya sama dengan data BBI.
- **Fase 2, Admin.** Tab admin "Macrotexture" menerima berkas CSV yang sama. Browser mengonversinya dengan **modul yang sama** dengan skrip seed, mengunggah hasilnya ke Vercel Blob, lalu mencatatnya di draf. Data baru terlihat pengunjung setelah Publish. Polanya sama dengan unggah BBI.

**Kedudukan metodologis.** Tab ini menyajikan tekstur makro sebagai data kondisi fungsional. Tiap unit membawa medan `k_flags` (ETD keel < 0,40 mm untuk tingkat Minimum, < 0,76 mm untuk tingkat Perencanaan) untuk dipakai kelak sebagai separuh sumbu K skema SKG (separuh lainnya μ152 dari data skid). **Berkas risiko tidak disentuh.** Penyambungan SKG ke engine risiko dikerjakan di brief terpisah.

Jangan ubah: `src/lib/risk.ts`, `risk-unit.ts`, `risk-unit-adapter.ts`, `fod-index.ts`, `src/config/riskScales.ts`, `icaoMatrix.ts`, seluruh `src/components/risk/`, seluruh `src/components/skid/`, seluruh `src/components/bbi/`, berkas `public/data/runway-*-units-*.json`, berkas `public/data/skid-*` dan `bbi-*`, serta fixture `src/lib/__fixtures__/tekstur-mpd-2026.json` (§3.6).

---

## 1. Ruang lingkup

**Termasuk**

1. Tipe, skema zod, dan modul konversi murni `src/lib/texture-import.ts` (tanpa React dan tanpa `ol`, bisa diuji dengan `node --test`).
2. Skrip seed `scripts/texture/build-texture.mjs` dan dua berkas seed `public/data/texture-06-24-2026.json` serta `texture-07L-25R-2026.json`.
3. Tab "Macrotexture" di halaman utama (§7).
4. Tab admin "Macrotexture", Vercel Function `api/texture-files.ts`, medan manifest `textureSurveys` di `DataOverrides`, dan pemilih survei di tab utama (§8).
5. Uji otomatis (§10) dan pembaruan dokumen (§12).

**Tidak termasuk**

- Menyambungkan tekstur ke perhitungan risiko (lihat §0).
- **Menyandingkan tekstur dengan PCI atau raveling per unit**, misalnya baris PCI di panel unit. Commit `e364b4c` membalik muatan PCI dengan tekstur ini sebagai jangkar, sedangkan pemilik proyek pada 3 Nov 2026 menolak kesimpulan itu. Tekstur ditempatkan menurut GPS (poligon band → sumbu poligon unit), jadi tidak bergantung pada persoalan itu. Penyandingan dikerjakan setelah persoalannya diputuskan.
- **Mengimpor CSV mentah LCMS ("… LCMS Texture Processed.csv") di browser.** Admin hanya menerima keluaran `olah_tekstur.m`. CSV mentah dikenali dan ditolak dengan pesan yang menunjuk ke paket (§5.1).
- Tekstur mikro. CSV LCMS tidak memuatnya (kolom MTD dan SMTD kosong).
- Lapisan peta per band (titik `lat`/`lon`) dan tampilan gambar LCMS. Panel unit hanya menampilkan **nama** berkas gambar.
- Grafik per segmen 10 m di dalam unit. Grafik sepanjang runway memakai nilai per unit.
- Mengedit nilai tekstur lewat admin, dan menghapus berkas Blob yang tidak lagi dirujuk.

---

## 2. Keadaan kode sekarang (baca sebelum mulai)

| Hal | Di mana | Catatan |
|---|---|---|
| Daftar tab utama | `src/pages/Home.tsx` (`WorkspaceTab`, `WORKSPACE_TABS`, `NARROW_BREAKPOINT = 800`) | Komentar `NARROW_BREAKPOINT` mencatat tab bar empat tab butuh 729 px `scrollWidth`. Tab kelima menambah lebar, jadi ukur ulang (§7.1). Salinan konstantanya ada di `src/hooks/useNarrowViewport.ts`. |
| Tab BBI (pola acuan utama) | `src/components/bbi/` (`BbiTab`, `BbiMap`, `BbiSummary`, `BbiProfileChart`, `BbiUnitPanel`, `BbiAbout`, `bbi-ui.ts`, `hover-store.ts`), `src/lib/bbi*.ts`, `src/types/bbi.ts`, `src/config/bbi.ts` | Ditiru polanya, **tidak diubah dan tidak diimpor silang**, kecuali komponen `ui/` dan helper umum. |
| Pemuatan data dengan cache | `useCachedLoad` di `src/hooks/useSkidData.ts` | `useBbiData.ts` sudah mengimpornya dari sana. Lakukan hal yang sama. |
| Poligon sample unit | `SEED_SAMPLE_UNIT_SOURCES["2026"][runway.replace("-", "/")]` di `src/lib/sample-units.ts` (kunci `"06/24"`, `"07L/25R"`, sama dengan `useBbiData.ts`) | Yang dipakai hanya geometri dan nomor unit. Muatan PCI di berkas itu **tidak dibaca** (§1). |
| Survei BBI (pola manifest) | `src/lib/bbi-surveys.ts`, `src/hooks/useBbiSurveys.ts` | Seed virtual + manifest admin, terbaru dulu. |
| Unggah Blob | `src/lib/bbi-upload.ts`, `api/bbi-files.ts` (`bbiUploadRule`, diuji di `src/lib/bbi-surveys.test.ts`) | Nama berkas memuat 12 hex SHA-256. Cek sesi admin disalin dari `api/auth.ts` dengan sengaja. |
| Draf dan Publish | `src/lib/data-overrides.ts` (`DataOverrides`, `normalizeOverrides` berupa whitelist), `src/lib/data-store.tsx` (`upsertBbiSurveyRunway`, `removeBbiSurvey`), `PublishBar.tsx` | Medan baru harus ditambahkan ke whitelist, kalau tidak akan hilang saat dimuat. |
| Halaman admin | `src/pages/Admin.tsx` (`AdminTab = "pci" \| "risk" \| "skid" \| "bbi"`) | `YearManager` disembunyikan untuk tab skid dan bbi. Perlakukan tab tekstur dengan cara yang sama. |
| Kunci URL bersama | `Home.tsx` baris efek `replaceState` dan `switchTab` (`SKID_URL_KEYS`, `BBI_URL_KEYS`) | Kunci tab tekstur harus ikut di kedua daftar (§7.6). |
| Uji | `package.json` → `"test": "node --test ..."` (daftar berkas eksplisit) | Berkas uji baru **harus ditambahkan ke daftar itu**. Node 22 menjalankan `.ts` langsung, jadi pakai sintaks TS yang bisa dihapus saja (tanpa `enum` dan tanpa parameter property) dan impor relatif berakhiran `.ts`. |
| Data mentah | `.gitignore` → `data-raw/` | CSV per band (4,6 dan 5,6 MB) ditaruh di `data-raw/texture-2026/` dan tidak di-commit. |
| Penomoran unit | `docs/penomoran-unit.md` | Unit 1 di ujung **06** / **07L**. Paket `TEKSTUR_2026` sudah memakai penomoran web. |
| Jangkar orientasi PCI | `src/lib/pci-orientation.test.ts` + `src/lib/__fixtures__/tekstur-mpd-2026.json` | Fixture itu MPD **lebar penuh per segmen** (AvgMPD), definisinya berbeda dengan keel di brief ini. Jangan diganti dan jangan diturunkan dari seed baru. |

---

## 3. Data sumber

### 3.1 Berkas

Salin dari `D:\Skripsi\Data Macro n Roughness\TEKSTUR_2026\hasil\` ke `data-raw/texture-2026/06-24/` (isi `hasil\0624\`) dan `data-raw/texture-2026/07L-25R/` (isi `hasil\07L25R\`):

| Peran | Berkas 06/24 | Baris | SHA-256 (12 hex) | Berkas 07L/25R | Baris | SHA-256 (12 hex) |
|---|---|---|---|---|---|---|
| `bands` | `tekstur_per_band_0624.csv` (4,60 MB) | 32.750 | `4f1db53f4ba4` | `tekstur_per_band_07L25R.csv` (5,56 MB) | 36.615 | `9c7a09f8b3e7` |
| `units-check` | `cek_per_unit_0624.csv` | 300 | `7d0f7cfbc083` | `cek_per_unit_07L25R.csv` | 360 | `eb851b89b17d` |
| `passes` | `ringkasan_lintasan_0624.csv` | 23 | `2a1560e133ce` | `ringkasan_lintasan_07L25R.csv` | 23 | `7c770fe9b0f3` |
| `photo-check` (opsional) | `cek_foto_0624.csv` | 262 | `a524e59a70cb` | `cek_foto_07L25R.csv` | 0 | `ccb9185c0b9a` |

**Format semua berkas:** pemisah `;`, desimal koma, akhir baris CRLF, UTF-8 tanpa BOM. Sel kosong berarti tidak ada nilai. Berkas `log_*.txt` dan `*.png` tidak dipakai web, tetapi angka di log menjadi angka cek (§10.3).

### 3.2 Kolom

`tekstur_per_band_*.csv` (satu baris = satu nilai band):
`segmen_id; lintasan; band; unit; zona_faa; jarak_dari_<E1>_m; stasiun_dari_<E2>_m; offset_m; mpd_mm; keel; cek_foto; lat; lon; arah; status; gambar`

`cek_per_unit_*.csv`:
`unit; zona_faa; jarak_tengah_dari_<E1>_m; n_keel; mpd_keel_rata_mm; mpd_keel_sd_mm; n_lebar_penuh; mpd_lebar_penuh_rata_mm`

`ringkasan_lintasan_*.csv`:
`lintasan; n_segmen; jarak_awal_dari_<E1>_m; jarak_akhir_dari_<E1>_m; pusat_pindaian_offset_m; mpd_rata_mm; arah; waktu_mulai`

`cek_foto_*.csv`:
`segmen_id; band; unit; jarak_dari_<E1>_m; offset_m; mpd_mm; keel; gambar`

`<E1>` dan `<E2>` adalah ujung runway: `06`/`24` untuk RWY 06/24, `07L`/`25R` untuk RWY 07L/25R. **Nama kolom itulah penentu runway** (§5.1).

### 3.3 Arti medan dan aturan baca

- `unit`: penomoran web, 1..N. `0` berarti di luar ujung runway. `zona_faa`: 1, 2, 3 (sepertiga panjang), `0` untuk unit 0.
- `jarak_dari_<E1>_m`: jarak sepanjang sumbu dari tepi luar unit 1. `stasiun_dari_<E2>_m`: dari tepi luar unit N, konvensi data skid. Jumlah keduanya tetap: **2.999,43 m** (06/24) dan **3.600,81–3.600,82 m** (07L/25R), terbulatkan 2 desimal.
- `offset_m`: jarak dari garis tengah poligon unit, **+ = selatan**, 2 desimal.
- `status`: `valid`, `dropout` (MPD ≤ 0), `luar` (di luar ±30 m atau di luar ujung), `belok` (putar balik, arah menyimpang > 20°). Hanya `valid` yang dipakai untuk statistik.
- `keel`: 1 bila band valid dan |offset| ≤ 6 m **pada presisi penuh MATLAB**. **Jangan menghitung ulang keel dari `offset_m`.** Offset CSV terbulatkan 2 desimal, sehingga ada nilai berlabel `6,00` yang di luar keel. Di 06/24 ada 10 nilai valid ber-|offset| tepat `6,00` (8 keel, 2 bukan). Di 07L/25R ada 20 (9 keel, 11 bukan). Menghitung ulang dengan `≤ 6` akan menambah 2 dan 11 nilai keel yang salah.
- `cek_foto`: 1 bila `mpd_mm` > 2,0. Nilainya tidak dibuang, hanya ditandai.
- `arah`: `ke <E2>` (= arah E, 06→24 / 07L→25R), `ke <E1>` (= arah W), atau `belok`.
- `gambar`: nama berkas gambar LCMS. Pola akhirnya `_<id survei LCMS 10 digit>_<nomor 6 digit>.jpg`.
- `ringkasan_lintasan.n_segmen` = jumlah segmen lintasan itu yang `arah` ≠ `belok` (terverifikasi di 46 dari 46 lintasan).

### 3.4 Penomoran dan geometri: sudah terverifikasi

Paket memakai poligon `runway-*-units-2026.json` versi 26 Okt 2026. Hari ini poligon itu dibandingkan dengan `public/data/runway-*-units-2026.json` commit `63eba0b`: **geometri identik** di 300 dan 360 unit (pembalikan muatan 2 Nov hanya memindahkan muatan PCI, bukan geometri). Proyeksi centroid poligon web ke sumbu, setelah disamakan di unit 1, cocok dengan `jarak_tengah` per unit dengan selisih maksimum **0,204 m** (06/24) dan **0,273 m** (07L/25R). Unit 1 berada di ujung barat di kedua runway. Uji B (§10) mengulang cek ini secara permanen.

**Sumbu tekstur tidak sama persis dengan sumbu BBI dan skid.** Panjang sumbu tekstur 06/24 = 2.999,43 m, BBI = 2.999,304 m. Antar-tab, sandingkan data **lewat nomor unit, jangan lewat jarak**.

### 3.5 Letak as runway

As = garis tengah poligon unit. Log MATLAB mengeceknya dengan dua cara: tengah amplop pindaian LCMS (+0,83 m di 06/24, +0,31 m di 07L/25R) dan pusat pindaian lintasan 1 (+1,10 m dan −0,83 m). Menggeser as ±1 m mengubah MPD keel per zona paling banyak 0,033 mm. Angka-angka ini masuk About (§11), bukan dihitung ulang web.

### 3.6 Fixture `tekstur-mpd-2026.json` tetap

`pci-orientation.test.ts` memakai MPD lebar penuh per segmen dari CSV mentah (centroid `AvgGeoJSON`, |offset| ≤ 30 m). Angkanya tidak sama dengan `full.mpd_mm` seed baru (yang dihitung per band dari keluaran paket). Kedua definisi sah untuk tujuannya masing-masing. Jangan disatukan.

---

## 4. Format berkas JSON: `texture-<runway>-<YYYY>.json`

Satu berkas per runway per survei, sekitar 0,15–0,2 MB. Tidak ada berkas trace terpisah.

Tulis tipe di `src/types/texture.ts` dan skema zod di `src/lib/texture-schema.ts`. Anotasi `z.ZodType<...>` sama seperti `bbi-schema.ts`, supaya `tsc` protes kalau tipe dan skema tidak cocok. `RunwayId` diimpor dari `src/types/skid.ts`.

```ts
export type TextureFileRole = "bands" | "units-check" | "passes" | "photo-check";
export type TextureZoneId = 1 | 2 | 3;

export interface TextureHighValue {
  segment_id: number;
  pass: number;
  band: 1 | 2 | 3 | 4 | 5;
  x_m: number;            // jarak_dari_<E1>_m
  offset_m: number;       // + = selatan
  mpd_mm: number;
  keel: boolean;
  image: string;          // kolom gambar, apa adanya
}

export interface TextureUnit {
  unit: number;                     // penomoran web, unit 1 di ujung 06 / 07L
  zone: TextureZoneId;
  x_mid_m: number;                  // jarak_tengah_dari_<E1>_m (1 desimal)
  station_mid_m: number;            // round(axis.length_m − x_mid_m, 1), konvensi skid
  keel: { n: number; mpd_mm: number | null; sd_mm: number | null; etd_mm: number | null };
  full: { n: number; mpd_mm: number | null; etd_mm: number | null };
  k_flags: { minimum: boolean | null; planning: boolean | null }; // null = tanpa nilai keel
  passes: { pass: number; n_keel: number }[];  // hanya lintasan dengan n_keel > 0, pass naik
  high_values: TextureHighValue[];              // nilai > 2,0 mm di unit ini, urut x_m lalu band
}

export interface TextureZone {
  zone: TextureZoneId;
  label: string;                    // "06 end" | "Middle" | "24 end" (07L/25R: "07L end", "Middle", "25R end")
  units: [number, number];
  n_keel: number;
  mpd_mm: number;                   // rata-rata SEMUA nilai keel zona (bukan rata-rata unit)
  etd_mm: number;
  n_units_with_keel: number;
  min_unit: number;                 // unit ber-ETD keel terendah; seri → nomor terkecil
  min_unit_etd_mm: number;
  n_units_below_0_76: number;
  n_units_at_or_above_1_14: number;
}

export interface TextureLaneSet { n: number[]; mpd_mm: (number | null)[] } // panjang 120

export interface TexturePass {
  pass: number;
  direction: "E" | "W";             // E = menuju <E2>
  n_segments: number;
  x_start_m: number;
  x_end_m: number;
  scan_center_offset_m: number;
  mpd_mm: number;
  start_time: string;               // "2026-06-28 18:04:48", waktu lokal dari CSV
}

export interface TextureRunwayData {
  schema_version: 1;
  kind: "texture-units";
  runway: RunwayId;
  survey: {
    id: string;                     // "2026-06"
    label: string;                  // "Jun 2026"
    date: string;                   // "2026-06-28"
    lcms_survey_id: string | null;  // "2062903736", diambil dari kolom gambar (§5.2)
    device: string;                 // "LCMS 3D laser, MPD per 10 m segment in 5 transverse bands"
    package: string;                // "TEKSTUR_2026 (olah_tekstur.m)"
  };
  unit_numbering: string;           // teks: unit 1 di ujung 06 / 07L
  axis: { length_m: number; x_rule: string; station_rule: string };
  keel: { half_width_m: number; rule: string };
  etd: { a: number; b: number; ref: string };     // ETD = a + b·MPD
  k_rule: { minimum_mm: number; planning_mm: number; comparator: "<"; note: string };
  qc: {
    n_values: number; valid: number; dropout: number; outside: number; turning: number;
    dropout_pct: number;            // 100·dropout/(valid+dropout), 3 desimal
    n_segments: number;
    high_threshold_mm: number;      // 2.0
    n_high: number; n_high_keel: number;
  };
  coverage: { n_units_total: number; n_units_with_keel: number; no_keel: number[] };
  runway_keel: { n: number; mpd_mm: number; etd_mm: number };
  runway_full: { n: number; mpd_mm: number; etd_mm: number };
  zones: TextureZone[];             // 3 entri, zona 1..3
  lanes: {
    width_m: 0.5; offset_min_m: -30; count: 120;
    rule: string;                   // §5.2
    all: TextureLaneSet; zone1: TextureLaneSet; zone2: TextureLaneSet; zone3: TextureLaneSet;
  };
  passes: TexturePass[];            // urut pass naik
  units: TextureUnit[];             // panjang = N, units[k-1].unit === k
  processing: { caveats: string[] };// §11
  source: {
    kind: "seed" | "admin-import";
    imported_at?: string;
    app_version?: string;
    files: { role: TextureFileRole; name: string; sha256: string; rows: number }[];
  };
}
```

Aturan isi:

- Statistik per unit dan per zona **dihitung dari `bands`**, lalu dicocokkan dengan `units-check` (V11). `units-check` hanya pemeriksa, nilainya tidak disalin.
- SD = simpangan baku sampel (pembagi n − 1, sama dengan `std` MATLAB). n < 2 → `null`.
- MPD, SD, dan ETD hasil hitung disimpan **6 desimal**, dan `k_flags` dihitung dari ETD presisi penuh sebelum dibulatkan. Alasannya pembulatan ganda: kalau disimpan 4 desimal, ETD unit 14 (0,686545…) menjadi 0,6865, lalu `(0.6865).toFixed(3)` di browser memberi `"0.686"`, padahal nilai sebenarnya 0,687. Dengan 6 desimal, `toFixed(3)` memberi angka yang benar. Rerata lajur disimpan 3 desimal. Jarak dan offset mengikuti presisi CSV. Tampilan memakai 3 desimal untuk mm.
- Kelas tampilan dan tingkat FAA **tidak disimpan**. Keduanya dihitung di UI dari `etd_mm` lewat `src/config/texture.ts` (§9), supaya perubahan ambang tidak memerlukan konversi ulang. `k_flags` disimpan karena menjadi masukan SKG, dan ambangnya dicatat di `k_rule`.

---

## 5. Modul konversi murni: `src/lib/texture-import.ts`

Satu modul dipakai bersama oleh skrip seed (§6) dan admin (§8). Modul ini tanpa React, tanpa `ol`, tanpa `fs`, dan impornya relatif berakhiran `.ts`.

```ts
export interface Issue { level: "error" | "warn"; file?: string; message: string }
export interface TextureInputFile { name: string; text: string }
export interface TextureBuildOptions {
  runway: RunwayId;
  nUnits: number;                    // 300 untuk 06-24, 360 untuk 07L-25R
  survey: Omit<TextureRunwayData["survey"], "lcms_survey_id"> & { lcms_survey_id?: string | null };
  sourceKind: "seed" | "admin-import";
  requireComplete: boolean;          // true di seed dan admin; false hanya di uji fixture
  checkUnits?: number[];             // hanya dipakai bila requireComplete=false: unit yang dicek V11
  sha256?: Record<string, string>;   // nama berkas -> hash (dihitung pemanggil)
}
export interface TextureBuild {
  data: TextureRunwayData | null;    // null kalau ada error
  issues: Issue[];
  roles: Record<string, TextureFileRole | "unknown" | "raw-lcms">;
  report: string[];
}
export function detectRole(headerLine: string): TextureFileRole | "unknown" | "raw-lcms";
export function detectRunway(headerLine: string): RunwayId | null; // kolom berakhiran _dari_06_m → 06-24, _dari_07L_m → 07L-25R
                                                                   // (jarak_dari_*, jarak_tengah_dari_*, jarak_awal_dari_*; stasiun_dari_24/25R diabaikan)
export function parseDecimal(s: string): number | null;            // "1,034" -> 1.034, "" -> null, selain itu NaN -> error
export function buildTexture(files: TextureInputFile[], opt: TextureBuildOptions): TextureBuild;
```

### 5.1 Pembacaan

- Buang BOM di awal teks. Terima CRLF dan LF. Abaikan baris kosong di akhir.
- Kenali peran berkas dari **kepala kolom**, bukan dari nama berkas:
  - ada `MPDBand1` atau `AvgGeoJSON` → `raw-lcms`, dengan error `"<file> is the raw LCMS texture export. Run olah_tekstur.m in the TEKSTUR_2026 package and upload the files from hasil\<runway>\."` Cek ini dijalankan **sebelum** cek pemisah, karena CSV mentah memakai koma.
  - ada `mpd_keel_rata_mm` → `units-check`
  - ada `pusat_pindaian_offset_m` → `passes`
  - ada `status`, `keel`, dan `lintasan` → `bands`
  - ada `gambar` dan `mpd_mm` tanpa `status` → `photo-check`
  - selain itu → `unknown` (error).
- Pemisah wajib `;`. Kalau baris kepala tidak memuat `;`, beri error `"<file>: expected ';' as column separator (Indonesian-locale CSV from the TEKSTUR_2026 package)."`
- `bands`, `units-check`, dan `passes` wajib ada, masing-masing tepat satu. `photo-check` opsional, paling banyak satu.

### 5.2 Perhitungan

1. **Runway dan sumbu.** Runway dari nama kolom (V2). `axis.length_m` = median (`jarak` + `stasiun`) semua baris `bands`, dibulatkan 2 desimal.
2. **Per unit.** Dari baris `bands` ber-`status = valid` dan `unit > 0`:
   - `full`: semua nilai unit itu.
   - `keel`: nilai yang `keel = 1`.
   - `etd_mm = 0.2 + 0.8 × mpd_mm` (ASTM E1845 pers. 1). Karena linear, ETD rata-rata = ETD dari MPD rata-rata.
   - `x_mid_m` dari `units-check`; `station_mid_m` = round(`axis.length_m − x_mid_m`, 1).
   - `k_flags.minimum` = `etd_mm < TEXTURE_K_MINIMUM_MM`; `k_flags.planning` = `etd_mm < TEXTURE_K_PLANNING_MM`; keduanya `null` bila `keel.n = 0`.
   - `passes`: hitungan nilai keel per `lintasan`.
   - `high_values`: baris valid ber-`cek_foto = 1` di unit itu.
3. **Zona.** Zona `z` = unit `1 + floor((z−1)·N/3)` sampai `z·N/3` (06/24: 1–100, 101–200, 201–300; 07L/25R: 1–120, 121–240, 241–360). `mpd_mm` zona = rata-rata **semua nilai keel** di zona itu, sama dengan log MATLAB. `min_unit` memakai ETD keel per unit.
4. **Runway.** `runway_keel` dan `runway_full` dari semua nilai keel / valid dengan `unit > 0`.
5. **Lajur melintang.** Semua nilai valid ber-`unit > 0`. Indeks lajur `i = floor((offset_m + 30) / 0.5)`, dibatasi `0..119` (offset 30,00 masuk lajur 119). Lajur `i` mencakup `[−30 + 0,5i, −30 + 0,5(i+1))`. Isi `all` dan `zone1..3` (menurut `zona_faa`). `mpd_mm` lajur `null` bila `n = 0`. Teks `lanes.rule` menjelaskan rumus ini.
   Catatan: lajur memakai offset terbulatkan, sedangkan statistik keel memakai kolom `keel`. Karena itu rata-rata lajur −6..+6 m (6.281 nilai di 06/24) tidak sama persis dengan statistik keel (6.284 nilai). Ini disengaja.
6. **QC.** Hitungan `status`, `dropout_pct`, jumlah segmen unik, `n_high`, `n_high_keel`.
7. **ID survei LCMS.** Ambil dari kolom `gambar` dengan pola `_(\d{10})_\d{6}\.jpg$`. Kalau semua baris memberi satu ID, isi `lcms_survey_id`. Kalau pemanggil memberi ID lain, pakai milik pemanggil dan beri peringatan. Kalau tidak seragam, isi `null` dan beri peringatan.

### 5.3 Validasi

Error menghentikan pembangunan (`data` jadi null). Peringatan hanya ditampilkan.

| # | Cek | Tingkat |
|---|---|---|
| V1 | Semua kolom §3.2 ada di berkasnya | error |
| V2 | Runway dari nama kolom sama di semua berkas dan sama dengan `opt.runway` | error: `"<file> is for RWY <x>, but RWY <y> is selected."` |
| V3 | `band` ∈ 1..5; `status` ∈ {valid, dropout, luar, belok}; `keel`, `cek_foto` ∈ {0, 1}; `unit` ∈ 0..N; `zona_faa` ∈ 0..3; `unit = 0` ⇔ `zona_faa = 0` | error |
| V4 | `zona_faa` sama dengan aturan zona §5.2 butir 3, di `bands` dan `units-check` | error |
| V5 | Tiap `segmen_id` punya tepat 5 baris (band 1..5) dengan `lintasan` dan `arah` sama | error |
| V6 | `keel = 1` ⇒ `status = valid`, `unit > 0`, dan \|offset\| ≤ 6,005. Baris valid ber-`unit > 0` dengan `keel = 0` ⇒ \|offset\| ≥ 5,995 | error |
| V7 | `status = dropout` ⇒ `mpd_mm` ≤ 0; `status = valid` ⇒ `mpd_mm` > 0; `status = belok` ⇔ `arah = belok` | error |
| V8 | `cek_foto = 1` ⇔ `mpd_mm` > 2,0 | error |
| V9 | `jarak + stasiun` maks − min ≤ 0,02 m | error |
| V10 | `units-check` berisi tepat N baris, `unit` 1..N masing-masing sekali | error |
| V11 | Per unit: `n_keel` dan `n_lebar_penuh` sama persis; `mpd_keel_rata_mm`, `mpd_keel_sd_mm`, `mpd_lebar_penuh_rata_mm` selisih ≤ 0,0006 mm; sel kosong ⇔ n = 0 (SD: n < 2) | error. Bila `requireComplete` false, hanya unit di `checkUnits` |
| V12 | Himpunan `lintasan` di `passes` = di `bands`; `n_segmen` = jumlah segmen lintasan itu ber-`arah` ≠ `belok`; `arah` lintasan = `arah` baris non-belok-nya | error bila `requireComplete`, kalau tidak dilewati |
| V13 | Bila ada `photo-check`: barisnya sama dengan baris `bands` ber-`cek_foto = 1` (`segmen_id`, `band`, `mpd_mm`, `gambar`) | error bila `requireComplete`, kalau tidak dilewati |
| V14 | `dropout_pct` > 20 | error (batas E1845 §7.1 menurut README paket); > 5 → warn |
| V15 | Unit tanpa nilai keel lebih dari 2% dari N | warn |
| V16 | Ada unit dengan 1 ≤ `n_keel` < 10 | warn: `"Unit <k>: only <n> keel values."` |
| V17 | `n_high` > 0 | warn: `"<n> band values above 2 mm (<m> in the keel). Check the LCMS images listed in the unit panel."` |

Pesan error dan peringatan berbahasa Inggris, menyebut nama berkas dan nomor baris (baris 1 = kepala).

### 5.4 Laporan

`report` berisi: nama, hash, dan jumlah baris tiap berkas; runway dan panjang sumbu; hitungan status dan `dropout_pct`; cakupan unit; tabel zona (n, MPD, ETD, tingkat FAA); ETD keel runway dan lebar penuh; unit ber-ETD terendah dan tertinggi; sebaran kelas tampilan (§9); jumlah `k_flags` true/false/null untuk kedua tingkat; `n_high` dan `n_high_keel`; selisih maksimum V11.

---

## 6. Fase 1: seed

### 6.1 Skrip `scripts/texture/build-texture.mjs`

```
node scripts/texture/build-texture.mjs --src data-raw/texture-2026/06-24 --runway 06-24 \
     --survey 2026-06 --label "Jun 2026" --date 2026-06-28            # cek saja, cetak laporan
node scripts/texture/build-texture.mjs ... --write                       # tulis berkas
```

- Membaca semua `*.csv` di `--src` (abaikan `*.txt` dan `*.png`), menghitung SHA-256 tiap berkas (`node:crypto`), lalu memanggil `buildTexture` dengan `requireComplete: true` dan `sourceKind: "seed"`. `--lcms` opsional (§5.2 butir 7).
- Ada error → cetak semuanya, exit 1, tanpa menulis apa pun.
- Dengan `--write`: tulis `public/data/texture-<runway>-2026.json` (`JSON.stringify` tanpa indentasi, diakhiri `\n`), lalu **tambahkan** laporan ke `scripts/texture/build-texture-report-2026-11-04.txt` dengan judul per runway.
- Tambahkan ke `package.json`:
  `"texture:seed": "node scripts/texture/build-texture.mjs --src data-raw/texture-2026/06-24 --runway 06-24 --survey 2026-06 --label \"Jun 2026\" --date 2026-06-28 --write && node scripts/texture/build-texture.mjs --src data-raw/texture-2026/07L-25R --runway 07L-25R --survey 2026-06 --label \"Jun 2026\" --date 2026-06-18 --write"`
- Kedua JSON di-commit. Folder `data-raw/` tetap di-ignore.

### 6.2 Daftar survei tekstur: `src/lib/texture-surveys.ts`

Salin pola `bbi-surveys.ts`:

```ts
export const SEED_TEXTURE_SURVEY_ID = "2026-06";
export interface TextureSurveyRunwayUrls { url: string; date: string; source: "seed" | "admin" }
export interface TextureSurveyView { id: string; label: string; runways: Partial<Record<RunwayId, TextureSurveyRunwayUrls>> }
export function listTextureSurveys(manifest?: Record<string, TextureSurveyEntry>): TextureSurveyView[];
```

- Seed berisi **kedua runway**: `/data/texture-06-24-2026.json` (tanggal `2026-06-28`) dan `/data/texture-07L-25R-2026.json` (`2026-06-18`).
- Runway di manifest menggantikan runway seed pada id yang sama. Urutan daftar: tanggal terbaru dulu (tanggal terbaru di antara runway-nya, sama dengan BBI).

---

## 7. Tab "Macrotexture"

Semua teks UI berbahasa Inggris. Komponen baru ditaruh di `src/components/texture/`: `TextureTab.tsx`, `TextureMap.tsx`, `TextureLegend.tsx`, `TextureSummary.tsx`, `TextureZoneTable.tsx`, `TextureAlongChart.tsx`, `TextureCrossSection.tsx`, `TextureUnitPanel.tsx`, `TextureAbout.tsx`, `texture-ui.ts`, dan `hover-store.ts` (salinan milik tekstur sendiri, bukan impor dari bbi atau skid). Hook baru: `src/hooks/useTextureSurveys.ts` dan `useTextureData.ts`. Helper murni ditaruh di `src/lib/texture.ts`: `summarizeTexture`, `alongRows`, `laneRows`, dan `unitRanges` (boleh disalin dari `bbi.ts`).

### 7.1 Pendaftaran tab

- `Home.tsx`: `WorkspaceTab = "pci" | "skid" | "bbi" | "texture" | "risk"`. Entri baru `{ id: "texture", label: "Macrotexture", shortLabel: "Texture" }` disisipkan **di antara BBI dan Risk**. `?tab=texture` membuka tab ini.
- Ukur ulang `scrollWidth` tab bar dengan label penuh, seperti dijelaskan komentar `NARROW_BREAKPOINT`. Taksiran ±845 px, jadi 800 tidak lagi cukup. Naikkan `NARROW_BREAKPOINT` di `Home.tsx` **dan** `useNarrowViewport.ts` ke angka hasil ukur + margin (taksiran 900), lalu catat angka ukurnya di komentar.
- Tab memuat data hanya saat dibuka (lazy). Data tekstur dan poligon dimuat begitu tab aktif.

### 7.2 Tata letak (dari atas ke bawah)

1. **Toolbar**
   - Pemilih runway: `RWY 06/24` dan `RWY 07L/25R`, keduanya aktif. Bawaan `06/24`.
   - Pemilih survei, hanya tampil bila ada lebih dari satu survei.
2. **Strip ringkasan** (`TextureSummary`), contoh 06/24:
   - *Keel ETD* `1.006 mm`, dengan keterangan `±6 m, 6,284 values`.
   - *FAA zones* `3 of 3 below 1.14 mm`, dengan keterangan `measure texture at every friction survey`.
   - *Lowest unit* `0.687 mm`, dengan keterangan `unit 14`.
   - *Units below 0.76 mm* `14 of 297`.
   - *Coverage* `297 / 300 units`, dengan keterangan `no keel values: units 1, 299, 300`.
   - *Values above 2 mm* `262`, dengan keterangan `110 in the keel · check LCMS images`. Kartu ini disembunyikan bila 0.
3. **Tabel vonis FAA per zona** (`TextureZoneTable`). Kolom: *Zone*, *Units*, *Keel values*, *MPD (mm)*, *ETD (mm)*, *AC 150/5320-12C par. 3-23b*, *Lowest unit*, *Units < 0.76*, *Units ≥ 1.14*. Kolom vonis berisi teks tingkat FAA (§9) dengan chip warnanya. Klik baris menyorot zona di peta dan grafik. Di bawah tabel: *"FAA judges the average texture depth of each runway zone (touchdown, midpoint, rollout). The runway is used in both directions, so the zones here are thirds by position."*
4. **Peta** (`TextureMap`, OpenLayers seperti `BbiMap`). Poligon unit 2026 diwarnai menurut kelas tampilan ETD keel (§9). Unit tanpa nilai keel diberi warna *No keel values*. Unit dengan nilai keel > 2 mm diberi arsir tipis (pakai `src/lib/hatch-pattern.ts`).
   - Hover menampilkan tooltip `Unit 14 · keel ETD 0.687 mm · zone 1 (06 end)`.
   - Klik memilih unit dan membuka panel unit.
   - Batas zona digambar sebagai garis tipis melintang runway di antara unit 100/101 dan 200/201 (07L/25R: 120/121, 240/241).
5. **Legenda** (`TextureLegend`). Kelas tampilan beserta jumlah unit, dan satu kalimat: *"Only 1.14, 0.76 and 0.25 mm are FAA levels (AC 150/5320-12C par. 3-23b), and FAA applies them to zone averages; bands between 0.76 and 1.14 mm are display bands."*
6. **Grafik sepanjang runway** (`TextureAlongChart`). Lihat §7.3.
7. **Profil melintang** (`TextureCrossSection`). Lihat §7.4.
8. **Panel unit** (`TextureUnitPanel`). Panel samping di layar lebar, lembar bawah di layar sempit, seperti BBI. Lihat §7.5.
9. **About this data** (`TextureAbout`). Lipatan berisi butir §11.

### 7.3 Grafik sepanjang runway

- **Sumbu.** Sumbu x adalah jarak dari ambang 06 / 07L (`x_mid_m`), 0 sampai `axis.length_m`, searah nomor unit. Sumbu y bawaan ETD (mm), mulai dari 0, dengan batas atas `max(1.3, maks terlihat × 1.05)`.
- **Seri.**
  - *Keel ETD*: garis + titik per unit, warna `TEXTURE_SERIES.keel`. Unit tanpa nilai keel memutus garis (`connectNulls={false}`).
  - *Full width ETD*: garis tipis abu-abu `TEXTURE_SERIES.full`.
  - *Zone average*: tiga ruas horizontal tebal semi-transparan, masing-masing selebar zonanya, di nilai `zones[].etd_mm`.
- **Garis ambang** (`ReferenceLine`, dari `TEXTURE_THRESHOLD_LINES`): 1,14 *"1.14 mm: measure with friction surveys"*, 0,76 *"0.76 mm: plan correction"*, 0,40 *"0.40 mm"*, 0,25 *"0.25 mm: correct within 2 months"*.
- **Sakelar ETD | MPD.** Mode MPD menggambar MPD keel dan lebar penuh, **tanpa** garis ambang, dengan catatan *"FAA levels apply to ETD."*
- **Tooltip.** Unit, jarak dari 06, zona, ETD keel, MPD keel, SD, n keel, dan ETD lebar penuh.
- **Zoom.** Seret untuk memperbesar, lalu tombol *Reset zoom*. Tombol *Show in chart* di panel unit menyetel jendela ke unit itu ±50 m.
- **Sorot.** Unit terpilih diberi `ReferenceArea` tipis. Hover di grafik menyorot unit di peta lewat `hover-store`, dan sebaliknya.

### 7.4 Profil melintang

- **Sumbu.** Sumbu x adalah offset dari as runway, −30 sampai +30 m. Label ujung kiri *"North"* dan ujung kanan *"South"*. Sumbu y adalah MPD rata-rata per lajur 0,5 m, dengan sumbu kanan sekunder ETD (= 0,2 + 0,8 × MPD).
- **Pemilih:** *Whole runway* | *06 end* | *Middle* | *24 end* (07L/25R: *07L end*, *Middle*, *25R end*). Bawaan *Whole runway*. Memilih zona di tabel §7.2 butir 3 ikut menyetel pemilih ini.
- **Jendela keel.** `ReferenceArea` −6..+6 m berlabel *"Keel ±6 m"*.
- **Lajur tipis.** Lajur dengan `n < TEXTURE_LANE_MIN_N` (20) digambar pudar dan diberi tooltip *"Few values (n < 20)"*. Lajur `n = 0` tidak digambar.
- **Tooltip.** Rentang lajur (mis. `+1.5 to +2.0 m`), n, MPD, ETD.
- Catatan kecil di bawah grafik: *"Lanes use offsets rounded to 0.01 m; keel statistics use the package's keel flag, so the −6..+6 m lanes can differ from the keel figures by a few values."*

### 7.5 Panel unit

Contoh untuk unit 14 RWY 06/24:

```
Unit 14 · 134.9 m from threshold 06 · zone 1 (06 end)
Keel ±6 m    n 22 · MPD 0.608 mm · SD 0.246 mm · ETD 0.687 mm
             Below 0.76 mm (display band; FAA judges the zone average)
Full width   n 113 · MPD 0.965 mm · ETD 0.972 mm
K flags      Minimum (ETD < 0.40): no · Planning (ETD < 0.76): yes
             stored for the SKG consequence axis; not used in Risk yet

Keel values by pass   P1 5 · P2 5 · P3 5 · P4 2 · P5 3 · P7 2

Values above 2 mm: 7 (0 in keel). Check the LCMS images.
  From 06 (m)  Offset (m)  Pass  Band  MPD (mm)  Image
  131.30       +15.67      10    4     2.01      …_002987.jpg
  131.30       +14.97      10    5     2.46      …_002987.jpg
  132.57       +15.24       8    2     2.52      …_002389.jpg
  …
```

- Nama gambar ditampilkan utuh di tooltip dan bisa disalin. Tabel nilai > 2 mm dilipat bila lebih dari 5 baris.
- Unit tanpa nilai keel menampilkan *"No band value within ±6 m of the centreline in this unit."*, lalu tetap menampilkan baris *Full width*.
- Tombol *Show in chart* (§7.3).

### 7.6 URL

Tambahkan `src/lib/texture-url.ts` dengan pola `bbi-url.ts`, beserta ujinya. Kuncinya `survey`, `rw`, `unit`, `zone` (`all|1|2|3`), `mode` (`etd|mpd`), dan `x` (`a-b`). Nilai tidak sah diabaikan diam-diam. Pakai `replaceState` seperti BBI. Ekspor `TEXTURE_URL_KEYS`, lalu di `Home.tsx` tambahkan ke **kedua** daftar: `own` untuk tab `texture`, dan larik kunci yang dibersihkan saat berpindah tab (`[...SKID_URL_KEYS, ...BBI_URL_KEYS, ...TEXTURE_URL_KEYS]`).

---

## 8. Fase 2: Admin

### 8.1 Manifest di `DataOverrides`

```ts
export interface TextureSurveyRunwayEntry {
  url: string;
  rawCsv: { role: TextureFileRole; name: string; url: string | null; sha256: string; bytes: number }[];
  date: string;           // "YYYY-MM-DD"
  lcmsSurveyId: string | null;
  importedAt: string;     // ISO
}
export interface TextureSurveyEntry { id: string; label: string; runways: Partial<Record<RunwayId, TextureSurveyRunwayEntry>> }
// DataOverrides:
textureSurveys?: Record<string, TextureSurveyEntry>;
```

- Tambahkan `textureSurveys: parsed.textureSurveys` ke `normalizeOverrides`. Itu whitelist, jadi tanpa baris ini medannya hilang saat dimuat.
- Tambahkan `upsertTextureSurveyRunway(surveyId, label, runway, entry)` dan `removeTextureSurvey(surveyId)` ke `data-store.tsx`, salinan pola BBI. Komentar `...prev, // keeps the year-less fields (...)` diperbarui supaya ikut menyebut `textureSurveys`.
- `useTextureSurveys()` = `listTextureSurveys(overrides.textureSurveys)`.

### 8.2 `api/texture-files.ts`

Salinan `api/bbi-files.ts`. Cek sesi admin tetap disalin dengan sengaja, dan komentar "COPIED ... change one, change all" di `api/overrides.ts`, `skid-files.ts`, dan `bbi-files.ts` diperbarui supaya ikut menyebut `texture-files.ts`. Ekspor fungsi murni `textureUploadRule(pathname, env)`:

- JSON: `^apms/<env>/texture/[a-z0-9-]{1,40}/units-(06-24|07L-25R)-[0-9a-f]{12}\.json$`, `application/json`, maks 5 MB.
- CSV: `^apms/<env>/texture/[a-z0-9-]{1,40}/raw/[0-9a-f]{12}-[A-Za-z0-9._-]{1,80}\.csv$`, `text/csv`, maks 5 MB.
- Path lain ditolak.

Ini Serverless Function kelima (sekarang ada `auth`, `overrides`, `skid-files`, `bbi-files`). Periksa batas jumlah function di paket Vercel proyek sebelum menambahkannya.

### 8.3 `src/lib/texture-upload.ts`

Salinan pola `bbi-upload.ts`:

- Direktori Blob: `apms/<env>/texture/<surveyId>/`.
- Berkas JSON `units-<rw>-<hash12>.json`.
- CSV `units-check`, `passes`, dan `photo-check` diunggah ke `raw/`. CSV `bands` **tidak diunggah**, karena berkas 07L/25R (5,56 MB) melewati batas 5 MB. Supaya seragam, berkas `bands` 06/24 juga tidak diunggah. Yang dicatat hanya nama, `sha256`, dan `bytes`-nya, dengan `url: null`.

### 8.4 Panel admin

`Admin.tsx`: `AdminTab` ditambah `"texture"` dengan label *"Macrotexture"* dan shortLabel *"Texture"*, di urutan yang sama dengan tab utama (setelah BBI). `YearManager` disembunyikan untuk tab ini.

`src/components/admin/TextureImportPanel.tsx`:

1. **Survey.** Pilih survei yang ada, atau buat baru. Isian survei baru: id `YYYY-MM` dan label. Survei seed `2026-06` tampil sebagai *"Jun 2026 (built-in)"*. Mengunggah ke id `2026-06` menggantikan runway seed itu di manifest.
2. **Runway.** `06-24` (N = 300) atau `07L-25R` (N = 360). Isian per runway: tanggal survei, dan LCMS survey id (terisi otomatis dari kolom `gambar` setelah Process, boleh diubah).
3. **Files.** Seret atau pilih 3–4 CSV sekaligus dari `hasil\<runway>\`. Batas ukuran: 10 MB untuk `bands`, 1 MB untuk berkas lain. Tabel berkas menampilkan nama, ukuran, peran terdeteksi, runway terdeteksi, dan tombol hapus. Berkas `log_*.txt` dan `*.png` ditolak dengan keterangan *"Not needed"*.
4. **Process.** Memanggil `buildTexture` dengan `requireComplete: true` dan `sourceKind: "admin-import"`. CSV per band (±37.000 baris) di-parse di main thread. Tampilkan spinner. Kalau UI terasa membeku lebih dari 1 detik, pindahkan ke Web Worker.
5. **Preview.**
   - Daftar error dan peringatan (gaya `IssueList` di `BbiImportPanel`).
   - Isi `report`.
   - Tabel zona (sama dengan §7.2 butir 3).
   - Tabel 10 unit ber-ETD keel terendah.
   - Mini-peta tidak perlu.
6. **Save to draft.** Hanya aktif bila tidak ada error. Unggah lewat `texture-upload.ts`, lalu panggil `upsertTextureSurveyRunway`. Tampilkan toast *"Saved to draft. Press Publish to make it visible."*

`src/components/admin/TextureSurveyList.tsx`: daftar survei di manifest beserta runway, tanggal, LCMS id, waktu impor, dan tombol *Remove* (dengan konfirmasi). Seed tidak bisa dihapus.

---

## 9. Konfigurasi: `src/config/texture.ts`

```ts
// Ambang FAA AC 150/5320-12C par. 3-23b (existing pavements), rata-rata texture depth per runway zone:
//   (1) < 1.14 mm: ukur texture depth setiap survei friction
//   (2) < 0.76 mm tetapi > 0.40 mm: rencanakan perbaikan dalam satu tahun
//   (3) < 0.25 mm: perbaiki dalam 2 bulan
// Rentang 0.25–0.40 mm tidak disebut AC; ditampilkan sebagai "gap", bukan diberi tindakan.
// par. 3-24: kedalaman groove tidak pernah ikut diukur. Cocokkan nomor halaman dengan salinan AC sebelum dikutip di naskah.
export const TEXTURE_LEVELS_MM = { measure: 1.14, plan: 0.76, gapUpper: 0.40, correct: 0.25 } as const;
// ASTM E1845 pers. 1: ETD = 0.2 + 0.8·MPD (mm).
export const ETD_A = 0.2;
export const ETD_B = 0.8;
export const TEXTURE_KEEL_HALF_WIDTH_M = 6;   // KEPUTUSAN penelitian; diterapkan di paket MATLAB, web hanya mencatat
export const TEXTURE_HIGH_MPD_MM = 2.0;
export const TEXTURE_LANE_MIN_N = 20;
// KEPUTUSAN penelitian (skema SKG, 2 Nov 2026): K tingkat Minimum dan tingkat Perencanaan dari tekstur.
export const TEXTURE_K_MINIMUM_MM = 0.40;
export const TEXTURE_K_PLANNING_MM = 0.76;
// KEPUTUSAN tampilan (bukan kelas FAA): batas bawah inklusif.
export const TEXTURE_DISPLAY_BANDS = [0.85, 0.95, 1.05] as const;

export type TextureFaaLevel = "ok" | "measure" | "plan" | "gap" | "correct";
export type TextureClass = "ok" | "d4" | "d3" | "d2" | "d1" | "plan" | "gap" | "correct" | "noData";
export function faaLevel(etd: number): TextureFaaLevel;
export function classifyTexture(etd: number | null): TextureClass;
export const etdFromMpd = (mpd: number) => ETD_A + ETD_B * mpd;
```

Aturan kelas (batas bawah inklusif):

| Kelas | Rentang ETD | Tingkat FAA | Label legenda | Warna isi | Warna teks | 06/24 | 07L/25R |
|---|---|---|---|---|---|---|---|
| `ok` | ≥ 1,14 | `ok` | ≥ 1.14 mm | `#5C3A1A` | `#FFFFFF` | 50 | 0 |
| `d4` | 1,05 – < 1,14 | `measure` | 1.05 – < 1.14 | `#8B5E34` | `#FFFFFF` | 31 | 13 |
| `d3` | 0,95 – < 1,05 | `measure` | 0.95 – < 1.05 | `#B9875A` | `#1E1309` | 93 | 52 |
| `d2` | 0,85 – < 0,95 | `measure` | 0.85 – < 0.95 | `#DDB98F` | `#2B1D0E` | 60 | 79 |
| `d1` | 0,76 – < 0,85 | `measure` | 0.76 – < 0.85 | `#F2E3CC` | `#2B1D0E` | 49 | 210 |
| `plan` | 0,40 – < 0,76 | `plan` | < 0.76 mm (plan correction) | `#C2185B` | `#FFFFFF` | 14 | 6 |
| `gap` | 0,25 – < 0,40 | `gap` | 0.25 – < 0.40 mm (no action stated) | `#880E4F` | `#FFFFFF` | 0 | 0 |
| `correct` | < 0,25 | `correct` | < 0.25 mm (correct within 2 months) | `#4A0626` | `#FFFFFF` | 0 | 0 |
| `noData` | tanpa nilai keel | – | No keel values | `rgba(140,140,140,0.25)` | `hsl(var(--foreground))` | 3 | 0 |

Teks tingkat FAA untuk tabel zona:

- `ok`: *"At or above 1.14 mm"*
- `measure`: *"Below 1.14 mm: measure texture depth at every friction survey (3-23b(1))"*
- `plan`: *"Below 0.76 mm: plan correction within a year (3-23b(2))"*
- `gap`: *"0.25–0.40 mm: between 3-23b(2) and (3); the AC states no action"*
- `correct`: *"Below 0.25 mm: correct within 2 months (3-23b(3))"*

Ramp cokelat sengaja berbeda dari skala PCI, ungu skid, dan teal BBI. Merah muda–merah tua disisakan untuk tingkat FAA di bawah 0,76. Kontras teks di atas warna isi sudah ≥ 4,5:1 untuk semua baris (terendah `d4` 5,6:1). Uji M (§10) memastikannya, mengikuti uji kontras di `bbi.test.ts`.

Warna seri grafik (`TEXTURE_SERIES`): keel `#8B5E34`, full width `#8C8C8C`, rata-rata zona `#5C3A1A` dengan opasitas 0,35. Garis ambang (`TEXTURE_THRESHOLD_LINES`): 1,14 `#5F5E5A` putus `2 4`; 0,76 `#C2185B` putus `6 4`; 0,40 `#880E4F` putus `2 2`; 0,25 `#4A0626` penuh.

---

## 10. Uji otomatis

### 10.1 Fixture

Salin folder `fixtures/` di samping brief ini ke `src/lib/__fixtures__/texture/`:

| Berkas | Isi | SHA-256 (12 hex) |
|---|---|---|
| `cek_per_unit_0624.csv`, `cek_per_unit_07L25R.csv` | Salinan utuh, identik byte dengan sumber | §3.1 |
| `ringkasan_lintasan_0624.csv`, `ringkasan_lintasan_07L25R.csv` | Salinan utuh | §3.1 |
| `cek_foto_0624.csv` | Salinan utuh | §3.1 |
| `tekstur_per_band_0624_cuplikan.csv` | Kepala + 790 baris: semua segmen yang menyentuh unit 1, 2, 3, 13, 14, 15, 31, 32 (158 segmen × 5 band) | `d6b3fababdb5` |
| `tekstur_per_band_07L25R_cuplikan.csv` | Kepala + 245 baris: semua segmen yang menyentuh unit 6, 7, 8 (49 segmen × 5 band) | `7f8d19db4883` |
| `lcms_mentah_kepala.csv` | Baris kepala CSV mentah LCMS 06/24 saja (pemisah koma), untuk uji penolakan | `04ce52e42113` |

Karena cuplikan memuat semua segmen yang menyentuh unit-unit itu, statistik unit tersebut lengkap dan V11 harus lolos dengan `requireComplete: false`, `checkUnits` = daftar unit di atas.

### 10.2 Daftar uji

Berkas: `src/lib/texture-import.test.ts`, `src/lib/texture.test.ts`, `src/lib/texture-surveys.test.ts` (termasuk `textureUploadRule`, mengikuti tempat uji `bbiUploadRule`), `src/lib/texture-url.test.ts`, ditambah kasus baru di `src/lib/data-overrides.test.ts`. **Semuanya ditambahkan ke skrip `test` di `package.json`.**

| Uji | Isi |
|---|---|
| A. Pembacaan | `parseDecimal("1,034") === 1.034`, `parseDecimal("") === null`, `parseDecimal("abc")` → error. BOM dan LF diterima. `detectRole` untuk ketujuh fixture: `lcms_mentah_kepala.csv` → `raw-lcms` dengan pesan §5.1. `detectRunway` memberi `06-24` dan `07L-25R` untuk kepala yang sesuai. |
| B. Posisi = geometri web | Untuk tiap unit seed, `x_mid_m` dibandingkan dengan proyeksi centroid poligon `runway-<rw>-units-2026.json` ke garis centroid unit 1 → unit N, dengan offset disamakan di unit 1. Selisih maks < 0,5 m (terukur 0,204 dan 0,273 m). Bujur centroid unit 1 < unit N. |
| C. Rekonsiliasi | Fixture (`requireComplete: false`): V11 lolos untuk unit cuplikan. Seed: Σ `units[].keel.n` = `runway_keel.n` = Σ `zones[].n_keel`; Σ `units[].full.n` = `runway_full.n` = `qc.valid`; Σ `lanes.all.n` = `qc.valid`; Σ `lanes.zoneZ.n` = Σ `full.n` unit zona Z; `etd_mm` = 0,2 + 0,8 × `mpd_mm` (toleransi 2e-6) di semua unit dan zona. |
| D. Angka penerimaan | Semua angka §10.3 dari berkas seed. |
| E. Kelas | `classifyTexture`: 1,14 → ok; 1,1399 → d4; 0,95 → d3; 0,85 → d2; 0,76 → d1; 0,7599 → plan; 0,40 → plan; 0,3999 → gap; 0,25 → gap; 0,2499 → correct; null → noData. `faaLevel` di batas yang sama. |
| F. Skema | Kedua berkas seed lolos `TextureRunwaySchema`. Hasil `buildTexture` dari fixture lolos skema yang sama. |
| G. Error | Membuang `passes` → error peran hilang. Memilih runway `07L-25R` untuk berkas 06/24 → V2. Mengubah `keel` satu baris ber-\|offset\| > 7 menjadi 1 → V6. Mengubah satu `mpd_mm` keel di cuplikan → V11. Mengganti `;` dengan `,` → error pemisah. |
| H. K flags | Seed 06/24: minimum false 297, true 0, null 3; planning true 14, false 283, null 3. Seed 07L/25R: minimum false 360; planning true 6, false 354. |
| I. Survei | `listTextureSurveys()` tanpa manifest = seed dengan dua runway. Manifest dengan id `2026-06` menggantikan runway seed itu saja. Survei lebih baru tampil di depan. |
| J. Overrides | `normalizeOverrides` mempertahankan `textureSurveys`, dan medan tak dikenal tetap dibuang. |
| K. Rule Blob | `textureUploadRule` menerima path contoh units dan raw. Path ditolak bila memuat `..`, berhash 11 hex, berunway lain, berawalan `trace-`, atau berada di folder `bbi/`. |
| L. URL | Pola uji `bbi-url.test.ts`: nilai tidak sah diabaikan, dan nilai sah bolak-balik utuh. |
| M. Kontras | Semua pasangan warna isi–teks di `TEXTURE_CLASS_META` ≥ 4,5:1 (kecuali `noData`, yang memakai warna teks tema). |

### 10.3 Angka penerimaan

Semua angka di bawah dihitung hari ini dari berkas §3.1. Angka bertanda * sama dengan log MATLAB (`log_*.txt`). Angka mm ditulis 4 desimal; bandingkan dengan nilai seed (6 desimal) memakai toleransi 5e-5.

| Besaran | RWY 06/24 | RWY 07L/25R |
|---|---|---|
| Nilai band / segmen / lintasan | 32.750 / 6.550 / 23 * | 36.615 / 7.323 / 23 * |
| valid / dropout / luar / belok | 32.237 / 11 / 467 / 35 * | 36.562 / 18 / 35 / 0 * |
| `dropout_pct` | 0,034 * | 0,049 * |
| Panjang sumbu | 2.999,43 m | 3.600,82 m |
| Nilai keel | 6.284 * | 8.473 * |
| Unit tanpa nilai keel | 1, 299, 300 * | – * |
| n keel per unit (min / median / maks) | 12 / 21 / 24 * | 14 / 24 / 34 * |
| Keel runway: MPD / ETD | 1,0070 * / 1,0056 | 0,8299 * / 0,8639 |
| Lebar penuh runway: MPD / ETD | 0,7647 * / 0,8117 | 0,7187 * / 0,7749 |
| Zona 1: n / MPD / ETD | 2.028 / 1,0341 / 1,0273 * | 2.333 / 0,8475 / 0,8780 * |
| Zona 2: n / MPD / ETD | 2.101 / 0,9496 / 0,9597 * | 2.904 / 0,7452 / 0,7962 * |
| Zona 3: n / MPD / ETD | 2.155 / 1,0374 / 1,0299 * | 3.236 / 0,8931 / 0,9145 * |
| Tingkat FAA ketiga zona | `measure` | `measure` |
| Unit terendah per zona (ETD) | 14 (0,6865) · 152 (0,8011) · 295 (0,7305) | 7 (0,7473) · 151 (0,7510) · 350 (0,7674) |
| Unit < 0,76 per zona | 7 · 0 · 7 | 1 · 5 · 0 |
| Unit ≥ 1,14 per zona | 13 · 19 · 18 | 0 · 0 · 0 |
| ETD keel unit: min / median / maks | 0,6865 (unit 14) / 0,9916 / 1,7600 (unit 32) | 0,7473 (unit 7) / 0,8287 / 1,1120 (unit 299) |
| Unit < 0,76 | 5, 6, 11–15, 283–287, 289, 295 (14 unit) | 7, 151, 194–196, 220 (6 unit) |
| Kelas tampilan | ok 50, d4 31, d3 93, d2 60, d1 49, plan 14, gap 0, correct 0, noData 3 | ok 0, d4 13, d3 52, d2 79, d1 210, plan 6, gap 0, correct 0, noData 0 |
| ETD lebar penuh unit: min / maks | 0,6981 / 1,2462 | 0,7010 / 0,9109 |
| Nilai > 2 mm (`n_high` / di keel) | 262 / 110 | 0 / 0 |
| Unit berisi nilai > 2 mm | 42 unit; terbanyak unit 31 (14), 32 (12), 16 (11) | 0 |
| Unit berisi nilai keel > 2 mm (arsir peta) | 27: 22–26, 30–32, 179, 180, 184, 201–203, 205–208, 256–259, 261–265 | 0 |
| Lajur `all`: Σ n / lajur tertinggi | 32.237 / +1,5..+2,0 m, MPD 1,286, n 72 | 36.562 / 0,0..+0,5 m, MPD 0,930, n 312 |
| Lajur `all` 0,0..+0,5 m (indeks 60) | MPD 0,987, n 225 | MPD 0,930, n 312 |
| Lajur `all` kosong | 0 | 2 (−30,0 dan −29,5 m) |
| ID survei LCMS (dari `gambar`) | 2062903736 | 2061902896 |

Contoh unit untuk uji D:

| Unit | keel n / MPD / SD / ETD | full n / MPD / ETD | passes (pass: n) | nilai > 2 mm |
|---|---|---|---|---|
| 06/24 unit 14 | 22 / 0,6082 / 0,2458 / 0,6865 | 113 / 0,9651 / 0,9721 | 1:5, 2:5, 3:5, 4:2, 5:3, 7:2 | 7 (0 di keel) |
| 06/24 unit 32 | 22 / 1,9500 / 0,4191 / 1,7600 | 114 / 1,3077 / 1,2462 | 1:5, 2:4, 3:5, 4:2, 5:2, 7:2, 23:2 | 12 (10 di keel) |
| 06/24 unit 1 | 0 / null / null / null | 2 / 0,9800 / 0,9840 | – | 0 |
| 07L/25R unit 7 | 17 / 0,6841 / 0,1478 / 0,7473 | 79 / 0,6656 / 0,7325 | 1:5, 2:5, 4:2, 5:5 | 0 |

---

## 11. Butir "About this data" dan pertanyaan terbuka

Tampilkan di `TextureAbout`. Butir yang masih menunggu surveyor juga dicatat di `processing.caveats`.

1. **Sumber.** Survei LCMS 28 Juni 2026 untuk RWY 06/24 (ID 2062903736, "RUNWAY 2406 PCI") dan 18 Juni 2026 untuk RWY 07L/25R (ID 2061902896, "Runway Utara 18 Juni 2026"). MPD per segmen 10 m di 5 band melintang selebar pindaian ±4 m, dihitung software LCMS (prosedur ASTM E1845 §7.1–7.6 menurut README paket).
2. **Pengolahan.** Paket `TEKSTUR_2026` (`olah_tekstur.m`): MPD ≤ 0 berstatus dropout; baris putar balik dibuang; posisi band = titik tengah poligon band; as = garis tengah poligon sample unit; keel = band valid dengan |offset| ≤ 6 m.
3. **Letak as.** Tengah amplop pindaian LCMS +0,83 m (06/24) dan +0,31 m (07L/25R), pusat lintasan 1 +1,10 m dan −0,83 m dari as poligon. Menggeser as ±1 m mengubah MPD keel per zona paling banyak 0,033 mm.
4. **ETD.** ETD = 0,2 + 0,8 × MPD (ASTM E1845 pers. 1). Ambang FAA dinyatakan dalam texture depth volumetrik, jadi ETD dipakai sebagai penaksir texture depth. Asumsi ini ditulis eksplisit.
5. **Ambang FAA.** AC 150/5320-12C par. 3-23b menilai rata-rata per runway zone (touchdown, midpoint, rollout). Runway dipakai dua arah, jadi zona di sini adalah sepertiga panjang menurut posisi. Rentang 0,25–0,40 mm tidak disebut tindakannya oleh AC.
6. **Lebar keel ±6 m** adalah keputusan penelitian. Di 06/24 tekstur tinggi melebar sampai sekitar +11 m ke selatan (lihat profil melintang).
7. **Nilai > 2 mm** tidak dibuang. Nama gambar LCMS-nya ada di panel unit untuk dicek (raveling, tambalan, lampu, atau marka).
8. **SD** adalah sebaran antar-nilai band di unit 10 m, bukan SD segmen 100 mm seperti E1845 §8.1.13, karena data 100 mm tidak ada di CSV.
9. **Grooving belum diketahui.** Par. 3-24 tidak mengizinkan kedalaman groove ikut terukur. Kalau runway di-grooving dan alurnya tidak dibuang LCMS, MPD terlalu tinggi (menunggu surveyor).
10. **Algoritma MPD LCMS** (E1845 atau ISO 13473-1), interval sampel, dan kalibrasi belum dikonfirmasi surveyor. Urutan poligon band diasumsikan sama dengan `MPDBand1`–`MPDBand5`.
11. **Kedudukan.** Data kondisi fungsional, belum masuk perhitungan risiko. `k_flags` disimpan untuk sumbu K skema SKG.

Jangan menambah rujukan atau nomor halaman yang tidak ada di README paket atau di brief ini.

---

## 12. Dokumen yang diperbarui

- `docs/brief-texture-macrotexture.md`: brief ini disalin ke repo.
- `docs/penomoran-unit.md`, butir paket `TEKSTUR_2026`: tambahkan bahwa berkas web `public/data/texture-*-2026.json` memakai penomoran web (unit 1 di ujung 06 / 07L), dan bahwa `station_mid_m` mengikuti konvensi skid (dari ambang 24 / 25R).
- `README.md`: satu baris tentang tab Macrotexture dan perintah `npm run texture:seed`.

---

## 13. Urutan kerja dan pemeriksaan

1. Tipe, skema, `texture-import.ts`, `texture.ts`, `texture-surveys.ts`, `src/config/texture.ts`, fixture, dan uji A, C (fixture), E, G, I, M. Commit: *"Texture: tipe, skema, modul konversi, dan uji"*.
2. Skrip seed, `npm run texture:seed`, kedua JSON seed, laporan, dan uji B, C, D, F, H. Laporan harus memuat angka §10.3 persis. Commit: *"Texture: data seed Juni 2026 kedua runway dan skrip pembangun"*.
3. Tab Macrotexture, `texture-url.ts`, `NARROW_BREAKPOINT`, dan uji L. Commit: *"Texture: tab Macrotexture dengan zona FAA, peta, grafik, profil melintang, dan panel unit"*.
4. Manifest `textureSurveys`, `api/texture-files.ts`, `texture-upload.ts`, panel admin, pemilih survei, dan uji J, K. Commit: *"Admin: unggah CSV tekstur, simpan ke Blob, manifest textureSurveys, pemilih survei"*.
5. Dokumen §12. Commit: *"Docs: brief tekstur makro dan catatan penomoran"*.

Sebelum tiap commit: `npm test`, `npm run build` (`tsc -b` + vite), dan `npm run lint` harus bersih.

**Pemeriksaan manual di browser** (`npm run dev`):

- `?tab=texture` terbuka, dan tab PCI, Skid, BBI, serta Risk tidak berubah tampilan maupun angka.
- Tab bar muat tanpa scroll di lebar ≥ `NARROW_BREAKPOINT` baru, dan beralih ke label pendek di bawahnya.
- RWY 06/24: tabel zona menampilkan 1.027 / 0.960 / 1.030 mm, ketiganya *measure*. Unit 14 berwarna `plan` di peta. Mengekliknya membuka panel dengan isi §7.5, dan *Show in chart* memperbesar ke ±50 m sekitar 135 m.
- Unit 1, 299, dan 300 berwarna *No keel values*.
- Profil melintang *Whole runway* memuncak di dalam jendela keel, dan tekstur sisi selatan (+6..+11 m) lebih tinggi daripada sisi utara.
- RWY 07L/25R: tabel zona 0.878 / 0.796 / 0.914 mm (nilai penuh zona 3 = 0,914487, jadi tampilannya 0.914, bukan 0.915). Tidak ada kartu *Values above 2 mm* dan tidak ada arsir di peta.
- Berpindah Skid → Texture → BBI tidak membawa `unit` atau `rw` dari tab sebelumnya.
- Pada viewport 375 px, tab bar dan panel unit tetap terbaca.
- Admin: unggah `lcms_mentah_kepala.csv` → ditolak dengan pesan CSV mentah. Impor ulang empat CSV 06/24 ke survei uji (mis. `2026-07`). Preview menampilkan angka §10.3. Save to draft, lalu Publish di Preview deployment. Pemilih survei muncul di tab, dan survei uji bisa dihapus lagi dari daftar.
