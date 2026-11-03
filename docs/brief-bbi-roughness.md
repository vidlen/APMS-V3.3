# Brief implementasi: Tab Roughness (BBI) dan unggah BBI di Admin (APMS-V3.3)

Versi 1 · 3 November 2026
Repo: APMS-V3.3, dasar commit `a049884` (3 Nov 2026 14:53 WIB)
Data: paket MATLAB/ProFAA `D:\Skripsi\Data Macro n Roughness\BBI_RWY0624`, hasil `hasil_bbi\*_web.csv`
Fixture uji: folder `fixtures/` di samping brief ini (§10.1)

---

## 0. Ringkasan dan kedudukan metodologis

Nilai Boeing Bump Index (BBI) RWY 06/24 hasil survei LCMS 28 Juni 2026 dimasukkan ke web sebagai **tab keempat "Roughness (BBI)"**. Urutan tabnya PCI, Skid, Roughness (BBI), lalu Risk. Isinya peta per sample unit, grafik profil BBI 0,25 m sepanjang runway, panel unit dengan 8 garis ukur, dan panel About.

Pekerjaan dibagi dua fase, dan **keduanya dikerjakan dalam brief ini**.

- **Fase 1, seed.** Skrip Node mengubah empat CSV `*_web.csv` menjadi dua JSON di `public/data/`. Kedua JSON di-commit. Polanya sama dengan data skid Juni 2026.
- **Fase 2, Admin.** Tab admin "Roughness (BBI)" menerima keempat CSV yang sama. Browser mengonversinya dengan **modul yang sama** dengan skrip seed, mengunggah hasilnya ke Vercel Blob, lalu mencatatnya di draf. Data baru terlihat pengunjung setelah Publish. Polanya sama dengan unggah Skiddometer.

**Kedudukan metodologis.** Tab ini menyajikan BBI sebagai data kondisi fungsional. Berkas per unit sudah memuat medan `g_flag` (BBI maks unit > 1,0) untuk dipakai kelak sebagai sumbu G skema SKG. **Berkas risiko tidak disentuh.** Penyambungan SKG ke engine risiko dikerjakan di brief terpisah, setelah aturan K dari data skid web dikunci.

Jangan ubah: `src/lib/risk.ts`, `risk-unit.ts`, `risk-unit-adapter.ts`, `fod-index.ts`, `src/config/riskScales.ts`, `icaoMatrix.ts`, seluruh `src/components/risk/`, seluruh `src/components/skid/`, berkas `public/data/runway-*-units-*.json`, dan berkas `public/data/skid-*`.

---

## 1. Ruang lingkup

**Termasuk**

1. Tipe, skema zod, dan modul konversi murni `src/lib/bbi-import.ts` (tanpa React dan tanpa `ol`, bisa diuji dengan `node --test`).
2. Skrip seed `scripts/bbi/build-bbi.mjs` dan dua berkas seed `public/data/bbi-06-24-2026.json` serta `bbi-06-24-2026-trace.json`.
3. Tab "Roughness (BBI)" di halaman utama (§7).
4. Tab admin "Roughness (BBI)", Vercel Function `api/bbi-files.ts`, medan manifest `bbiSurveys` di `DataOverrides`, dan pemilih survei di tab utama (§8).
5. Uji otomatis (§10) dan pembaruan dokumen (§12).

**Tidak termasuk**

- Menyambungkan BBI ke perhitungan risiko (lihat §0).
- **BBI RWY 07L/25R.** ERD Runway Utara (`LCMS_1081000477_..._s1000mm_L/R.erd`) berinterval 1.000 mm, sedangkan BBI dihitung pada profil 0,25 m. Datanya masih menunggu klarifikasi surveyor. Skema dan admin tetap menerima runway `07L-25R` supaya survei berikutnya tidak perlu mengubah format, tetapi seed hanya berisi 06/24.
- Menyandingkan BBI dengan PCI per unit, misalnya baris PCI di panel unit BBI. Arah muatan PCI 06/24 2026 masih dipersoalkan: commit `e364b4c` membalik muatan, sedangkan pemilik proyek pada 3 Nov 2026 menolak kesimpulan itu. BBI ditempatkan menurut geometri (GPS → stasiun → poligon), jadi tidak bergantung pada persoalan itu. Penyandingan dikerjakan setelah persoalannya diputuskan.
- Aircraft Simulation ProFAA (berkas `... - 727 Sim - 100 knots.csv` dan seterusnya). AC 150/5380-9 tidak memberi kriteria penerimaan untuknya (README paket).
- Grafik kriteria bump (H lawan L) beserta kurva Excessive/Unacceptable. Rumus kurva Unacceptable belum dipegang dalam bentuk kode.
- Mengimpor berkas mentah ProFAA (`... - Boeing Bump Index.csv`) di browser. Admin hanya menerima keluaran `petakan_bbi_0624.m` + `konversi_unit_web.mjs`.
- IRI, mengedit nilai BBI lewat admin, menghapus berkas Blob yang tidak lagi dirujuk.

---

## 2. Keadaan kode sekarang (baca sebelum mulai)

| Hal | Di mana | Catatan |
|---|---|---|
| Daftar tab utama | `src/pages/Home.tsx` (`WorkspaceTab`, `WORKSPACE_TABS`, `NARROW_BREAKPOINT = 800`) | Komentar `NARROW_BREAKPOINT` menjelaskan lebar tab bar diukur. Tab keempat menambah lebar, jadi ukur ulang (§7.1). Salinan konstantanya ada di `src/hooks/useNarrowViewport.ts`. |
| Tab Skid (pola acuan) | `src/components/skid/SkidTab.tsx`, `SkidMap.tsx` (OpenLayers), `SkidProfileChart.tsx` (recharts), `SkidUnitPanel.tsx`, `SkidAbout.tsx`, `skid-ui.ts`, `hover-store.ts` | Ditiru polanya, **tidak diubah dan tidak diimpor silang**, kecuali komponen `ui/` dan helper umum. |
| Pemuatan data dengan cache | `src/hooks/useSkidData.ts` (`useCachedLoad`) | `useCachedLoad` boleh diimpor dari sini. Kalau mau dipindah ke `src/hooks/useCachedLoad.ts`, ekspor ulang dari `useSkidData.ts` supaya impor lama tetap jalan. |
| Poligon sample unit | `SEED_SAMPLE_UNIT_SOURCES["2026"]["06/24"]` di `src/lib/sample-units.ts` | Yang dipakai hanya geometri dan `id`. Muatan PCI di berkas itu tidak dibaca. |
| Survei skid (pola manifest) | `src/lib/skid-surveys.ts`, `src/hooks/useSkidSurveys.ts` | Seed virtual + manifest admin, terbaru dulu. |
| Unggah Blob | `src/lib/skid-upload.ts`, `api/skid-files.ts` | Nama berkas memuat 12 hex SHA-256. Cek sesi admin disalin dari `api/auth.ts` dengan sengaja. |
| Draf dan Publish | `src/lib/data-overrides.ts` (`DataOverrides`, `normalizeOverrides` berupa whitelist), `src/lib/data-store.tsx` (`upsertSkidSurveyRunway`, `removeSkidSurvey`), `PublishBar.tsx` | Medan baru harus ditambahkan ke whitelist, kalau tidak akan hilang saat dimuat. |
| Halaman admin | `src/pages/Admin.tsx` (`AdminTab = "pci" \| "risk" \| "skid"`) | `YearManager` disembunyikan untuk tab skid. Perlakukan tab BBI dengan cara yang sama. |
| Admin skid (pola acuan) | `src/components/admin/SkidImportPanel.tsx`, `SkidSurveyList.tsx` | Teks UI berbahasa Inggris (commit `3bef11d`). |
| Uji | `package.json` → `"test": "node --test ..."` (daftar berkas eksplisit) | Berkas uji baru **harus ditambahkan ke daftar itu**. Node 22 menjalankan `.ts` langsung, jadi pakai sintaks TS yang bisa dihapus saja (tanpa `enum` dan tanpa parameter property) dan impor relatif berakhiran `.ts`. |
| Data mentah | `.gitignore` → `data-raw/` | CSV per titik (7 MB) ditaruh di `data-raw/bbi-06-24-2026/` dan tidak di-commit. |
| Penomoran unit | `docs/penomoran-unit.md` | Unit 1 di ujung **06**. Stasiun skid diukur dari ambang 24 dan menurun menurut nomor unit. |

---

## 3. Data sumber

### 3.1 Berkas

Salin keempat berkas dari `D:\Skripsi\Data Macro n Roughness\BBI_RWY0624\hasil_bbi\` ke `data-raw/bbi-06-24-2026/`:

| Berkas | Baris data | Isi | SHA-256 (12 hex) |
|---|---|---|---|
| `bbi_per_unit_web.csv` | 300 | BBI maks tiap unit dari semua garis | `04eb1e0e45ac` |
| `bbi_per_unit_garis_web.csv` | 2.164 | BBI maks tiap unit per garis | `0af54fa42ebb` |
| `ringkasan_garis_web.csv` | 8 | Ringkasan tiap garis | `93de10b4c0ce` |
| `bbi_per_titik_web.csv` | 86.236 | Semua titik 0,25 m | `a2ff3eaee42c` |

**Format semua berkas:** pemisah `;`, desimal koma, akhir baris CRLF, UTF-8 tanpa BOM. Sel kosong berarti tidak ada nilai. Jangan pakai berkas tanpa akhiran `_web` (`bbi_per_unit.csv` dan seterusnya), karena berkas itu masih berpenomoran lama dengan unit 1 di ujung 24.

### 3.2 Kolom

`bbi_per_unit_web.csv`:
`unit_web; unit_lama; stasiun_awal_m; stasiun_akhir_m; jumlah_garis; bbi_maks; zona; garis_penentu; h_cm; panjang_bump_m; straightedge_m; catatan; jarak_dari_06_awal_m; jarak_dari_06_akhir_m`

`bbi_per_unit_garis_web.csv`:
`unit_web; unit_lama; garis; arah; offset_lintasan_m; bbi_maks; zona; h_cm; panjang_bump_m; straightedge_m; stasiun_m; x_profaa_m; pct_bbi_lebih_1; n_titik; catatan; jarak_dari_06_m`

`ringkasan_garis_web.csv`:
`unit_web; unit_lama; garis; arah; offset_lintasan_m; bbi_rata2; bbi_maks; zona; stasiun_m; h_cm; panjang_bump_m; n_excessive; n_unacceptable; jarak_dari_06_m`
(`unit_web` di sini adalah unit tempat BBI maks garis itu.)

`bbi_per_titik_web.csv`:
`unit_web; unit_lama; garis; x_profaa_m; stasiun_m; bbi; zona; h_cm; panjang_bump_m; straightedge_m; jarak_dari_06_m`

Arti medan:

- `stasiun_*` adalah jarak sepanjang sumbu dari tepi luar unit lama 1, yaitu ambang **24**.
- `jarak_dari_06_*` sama dengan `2999,304 − stasiun`. Angka 2999,304 m adalah `s_akhir` unit lama 300 di `batas_unit_0624.csv`.
- `x_profaa_m` adalah jarak dari awal berkas ProFAA, yaitu awal lintasan.
- `zona` berisi `Acceptable`, `Excessive`, `Unacceptable`, atau kosong. Kosong muncul pada 16 titik ber-BBI 0, yaitu titik pertama dan terakhir tiap garis.
- `catatan` berisi `tidak tercakup` atau `awal lintasan (straightedge belum utuh)`.
- `garis` berbentuk `RWY0624_P01_L` dan seterusnya. Di JSON, kode garis disingkat menjadi `P01_L`.

### 3.3 Penomoran: sudah terverifikasi

`unit_web = 301 − unit_lama` berlaku di semua baris. Hari ini aturan itu dicek terhadap poligon `public/data/runway-06-24-units-2026.json` commit `a049884`. Caranya: titik tengah rentang stasiun tiap unit di `batas_unit_0624.csv` dibandingkan dengan proyeksi centroid poligon web ke sumbu runway. Selisih maksimumnya **0,055 m** di 300 unit. Kalau nomor yang sama dipakai tanpa dibalik, selisihnya sampai 2.989,5 m. Uji B (§10) mengulang cek ini secara permanen.

**Stasiun BBI tidak sama persis dengan stasiun skid.** Contohnya unit 1: skid `station_start_m` = 2.988,45, sedangkan BBI = 2.989,3. Penyebabnya, kedua sumbu stasiun dibangun dengan cara berbeda. Antar-tab, sandingkan data **lewat nomor unit, jangan lewat stasiun.**

### 3.4 Garis ukur

8 garis dari lintasan 1, 2, 3, dan 5 (masing-masing sisi L dan R). Lintasan lain dari 22 lintasan belum diproses.

| Garis | Lintasan | Arah | Offset lintasan (m, + = selatan) | Jangkauan data, jarak dari 06 (m) | Titik |
|---|---|---|---|---|---|
| P01_L, P01_R | 1 | E (06→24) | 0,0 | 31,10 → 2.730,99 | 10.800 |
| P02_L, P02_R | 2 | W (24→06) | +5,4 | 2.963,10 → 262,82 | 10.800 |
| P03_L, P03_R | 3 | E | −3,6 | 32,30 → 2.723,02 | 10.759 |
| P05_L, P05_R | 5 | E | −6,4 | 35,20 → 2.726,33 | 10.759 |

- Pada lintasan ke timur, L berada di sisi utara. Pada lintasan ke barat, L berada di sisi selatan.
- **Offset masih sementara.** Jarak jejak roda L–R belum diketahui. README paket menyebut lintasan 1 kira-kira 5,8 m di utara garis tengah poligon, sedangkan README tekstur menyebut kira-kira 1 m. UI wajib menandai offset sebagai *provisional*.
- **250 m terakhir tiap lintasan dibuang** (artefak profiler saat mengerem). Akibatnya garis lintasan 1, 3, dan 5 tidak punya data di dekat ujung 24, dan garis lintasan 2 tidak punya data di dekat ujung 06.
- **120 m pertama tiap lintasan** ditandai `awal lintasan`, karena straightedge 120 m belum utuh di situ. Nilainya tetap dipakai.

---

## 4. Format berkas JSON

Tulis tipe di `src/types/bbi.ts` dan skema zod di `src/lib/bbi-schema.ts`. Anotasi `z.ZodType<...>` sama seperti `skid-schema.ts`, supaya `tsc` protes kalau tipe dan skema tidak cocok. `RunwayId` diimpor dari `src/types/skid.ts`.

### 4.1 Per unit: `bbi-<runway>-<YYYY-MM>.json`

```ts
export type BbiZone = "Acceptable" | "Excessive" | "Unacceptable";

export interface BbiLineMeta {
  code: string;               // "P01_L": pola ^P\d{2}_[LR]$, awalan "RWY0624_" dibuang
  source_name: string;        // "RWY0624_P01_L"
  pass: number;               // 1
  side: "L" | "R";
  direction: "E" | "W";       // E = 06→24, W = 24→06
  offset_m: number;           // offset lintasan terhadap lintasan 1, + = selatan
  offset_status: "provisional";
  bbi_mean: number;           // dari ringkasan_garis (bbi_rata2)
  bbi_max: number;
  max_unit: number;           // penomoran web
  max_x_from_06_m: number;
  n_excessive: number;
  n_unacceptable: number;
  x_first_from_06_m: number;  // titik pertama dan terakhir garis (setelah pemotongan 250 m)
  x_last_from_06_m: number;
}

export interface BbiUnitLine {
  line: string;               // kode garis
  bbi_max: number | null;     // null = garis tidak melintasi unit ini
  zone: BbiZone | null;
  h_cm: number | null;
  bump_length_m: number | null;
  straightedge_m: number | null;
  x_from_06_m: number | null; // letak BBI maks garis itu di dalam unit
  x_profaa_m: number | null;
  pct_over_1: number | null;  // % titik ber-BBI > 1 di unit ini
  n_points: number;           // 0 kalau null
  start_of_run: boolean;      // catatan "awal lintasan"
}

export interface BbiGoverning {
  line: string; bbi: number; zone: BbiZone;
  h_cm: number; bump_length_m: number; straightedge_m: number;
  start_of_run: boolean;
}

export interface BbiUnit {
  unit: number;                    // penomoran web, unit 1 di ujung 06
  unit_source: number;             // unit_lama (unit 1 di ujung 24), untuk pelacakan ke paket MATLAB
  x_from_06_start_m: number;
  x_from_06_end_m: number;
  station_from_24_start_m: number; // menurun menurut nomor unit, sama seperti skid
  station_from_24_end_m: number;
  lines_measured: number;          // 0..lines.length
  governing: BbiGoverning | null;  // null = tidak tercakup
  lines: BbiUnitLine[];            // selalu sepanjang meta lines, urutan sama dengan meta lines
  g_flag: boolean | null;          // governing.bbi > 1.0; null = tidak tercakup
}

export interface BbiRunwayData {
  schema_version: 1;
  kind: "bbi-units";
  runway: RunwayId;
  survey: {
    id: string;                    // "2026-06"
    label: string;                 // "Jun 2026"
    date: string;                  // "2026-06-28"
    lcms_survey_id: string | null; // "2062903736"
    device: string;                // "LCMS laser profilometer (ERD L/R, 5 mm)"
    software: string;              // "ProFAA 3.1.0"
    output_spacing_m: number;      // 0.25
  };
  unit_numbering: string;          // teks: unit 1 di ujung 06; unit = N + 1 − unit_source
  axis: { length_m: number; x_rule: string; station_rule: string };
  thresholds: { acceptable_max: 1.0; ref: string };
  g_rule: { threshold: 1.0; comparator: ">"; note: string };
  processing: {
    passes_used: number[];         // [1, 2, 3, 5]
    trimmed_end_m: number;         // 250
    start_of_run_m: number;        // 120
    corrections: string[];         // dua koreksi ekspor ProFAA (§4.3)
    caveats: string[];             // §11
  };
  coverage: { n_units_total: number; n_units_covered: number; not_covered: number[] };
  lines: BbiLineMeta[];            // urutan: pass naik, L sebelum R
  units: BbiUnit[];                // panjang = N, units[k-1].unit === k
  source: {
    kind: "seed" | "admin-import";
    imported_at?: string;
    app_version?: string;
    files: { role: BbiFileRole; name: string; sha256: string; rows: number }[];
  };
}

export type BbiFileRole = "units" | "unit-lines" | "lines" | "points";
```

Aturan isi:

- `governing` diambil dari `garis_penentu` CSV, **tidak dihitung ulang**. Kalau ada seri, MATLAB memilih garis pertama menurut urutan berkas, dan pilihan itu dipertahankan. Uji C memastikan `governing.bbi === max(lines[].bbi_max)`.
- `g_flag` memakai pembanding tegas `>`, jadi BBI tepat 1,0 berarti `false`.
- Semua angka disimpan dengan presisi CSV (BBI 4 desimal, panjang 2 desimal, stasiun 1 desimal). Bulatkan hanya di tampilan.

### 4.2 Per titik: `bbi-<runway>-<YYYY-MM>-trace.json`

```ts
export interface BbiLineTrace {
  line: string;
  n: number;                              // jumlah titik
  x0_from_06_m: number;                   // jarak_dari_06 titik ke-0
  dx_m: number;                           // (x_terakhir − x0) / (n − 1); negatif untuk lintasan W
  bbi: number[];                          // 4 desimal, indeks 0..n-1 searah lintasan
  unit_runs: [number, number, number][];  // [unit, i_awal, i_akhir] inklusif, berurutan
  flagged: { i: number; zone: "Excessive" | "Unacceptable" }[];
  null_zone_i: number[];                  // titik dengan zona kosong di CSV
  start_of_run_last_i: number;            // indeks terakhir dengan x_profaa_m < 120
}

export interface BbiRunwayTrace {
  schema_version: 1;
  kind: "bbi-trace";
  runway: RunwayId;
  survey_id: string;
  source_units_file: string;              // nama berkas per unit pasangannya
  spacing_profaa_m: number;               // 0.25
  x_rule: string;                         // "x_i = x0_from_06_m + i * dx_m"
  lines: BbiLineTrace[];                  // urutan sama dengan BbiRunwayData.lines
}
```

`x_i = x0 + i·dx` mereproduksi `jarak_dari_06_m` CSV dengan galat maksimum **0,0051 m** di kedelapan garis. Galat itu murni dari pembulatan 2 desimal di CSV. Nilai `dx`-nya: P01 +0,250013, P02 −0,250049, P03 +0,250113, P05 +0,250152. Setiap unit muncul tepat **satu kali** sebagai run di tiap garis (271 run untuk P01/P02, 270 untuk P03/P05). Kalau unit yang sama muncul dua kali, konversi harus gagal. Taksiran ukuran berkas sekitar 0,7 MB.

### 4.3 Teks tetap untuk `processing.corrections`

1. `ProFAA 3.1.0 export: "Distance (m)" is always 0; distance rebuilt from row order × 0.25 m (petakan_bbi_0624.m).`
2. `ProFAA 3.1.0 export: "Bump Height(m)" is 12× the true height (inches converted as feet); height recomputed as H = BBI × acceptable limit(L) (petakan_bbi_0624.m).`

Kedua koreksi sudah dikerjakan MATLAB. JSON hanya mencatatnya, dan konversi tidak menghitung ulang apa pun.

---

## 5. Modul konversi murni: `src/lib/bbi-import.ts`

Satu modul dipakai bersama oleh skrip seed (§6) dan admin (§8). Modul ini tanpa React, tanpa `ol`, tanpa `fs`, dan impornya relatif berakhiran `.ts`.

```ts
export interface Issue { level: "error" | "warn"; file?: string; message: string }
export interface BbiInputFile { name: string; text: string }
export interface BbiBuildOptions {
  runway: RunwayId;
  nUnits: number;                 // 300 untuk 06-24, 360 untuk 07L-25R
  survey: BbiRunwayData["survey"];
  sourceKind: "seed" | "admin-import";
  requireCompleteTrace: boolean;  // true di seed dan admin; false hanya di uji fixture
  sha256?: Record<string, string>; // nama berkas -> hash (dihitung pemanggil)
}
export interface BbiBuild {
  units: BbiRunwayData | null;    // null kalau ada error
  trace: BbiRunwayTrace | null;
  issues: Issue[];
  roles: Record<string, BbiFileRole | "unknown">;
  report: string[];               // baris laporan untuk skrip dan pratinjau admin
}
export function detectRole(headerLine: string): BbiFileRole | "unknown" | "old-numbering";
export function parseDecimal(s: string): number | null; // "1,1871" -> 1.1871, "" -> null, selain itu NaN -> error
export function buildBbi(files: BbiInputFile[], opt: BbiBuildOptions): BbiBuild;
```

### 5.1 Pembacaan

- Buang BOM di awal teks. Terima CRLF dan LF. Abaikan baris kosong di akhir.
- Pemisah wajib `;`. Kalau baris kepala tidak memuat `;`, beri error `"<file>: expected ';' as column separator (Indonesian-locale CSV from the BBI package)."`
- Kenali peran berkas dari **kepala kolom**, bukan dari nama berkas:
  - ada `garis_penentu` → `units`
  - ada `pct_bbi_lebih_1` → `unit-lines`
  - ada `n_excessive` → `lines`
  - ada `x_profaa_m` dan `bbi` → `points`
  - kepala diawali `unit;` tanpa `unit_web` → `old-numbering`, dengan error `"<file> uses the old unit numbering (unit 1 at threshold 24). Run node konversi_unit_web.mjs in the BBI package and upload the *_web.csv files."`
- Keempat peran wajib ada, masing-masing tepat satu berkas.

### 5.2 Validasi

Error menghentikan pembangunan (`units` dan `trace` jadi null). Peringatan hanya ditampilkan.

| # | Cek | Tingkat |
|---|---|---|
| V1 | Semua kolom §3.2 ada di berkasnya | error |
| V2 | `units` berisi tepat `nUnits` baris, `unit_web` 1..N masing-masing sekali | error |
| V3 | `unit_web === N + 1 − unit_lama` di setiap baris semua berkas | error |
| V4 | Kode garis cocok pola `^RWY\w+_P\d{2}_[LR]$`; kedelapan garis di `lines` sama dengan himpunan garis di `unit-lines` dan `points` | error |
| V5 | `jumlah_garis` = jumlah baris `unit-lines` unit itu | error |
| V6 | `bbi_maks` unit = maks `bbi_maks` garis-garisnya (toleransi 5e-5), dan `garis_penentu` adalah salah satu garis yang mencapai maks itu | error |
| V7 | `zona` di semua berkas ∈ {Acceptable, Excessive, Unacceptable, kosong}. Unit tercakup wajib berzona tidak kosong | error |
| V8 | Zona konsisten dengan BBI: BBI ≤ 1,0 → Acceptable atau kosong; BBI > 1,0 → Excessive atau Unacceptable | error |
| V9 | Titik `points` satu garis berurutan: `x_profaa_m` naik tepat 0,25 (toleransi 0,001) tanpa celah | error |
| V10 | Rekonstruksi `x0 + i·dx` lawan `jarak_dari_06_m` ≤ 0,02 m | error |
| V11 | Tiap unit muncul sebagai satu run kontigu di tiap garis | error |
| V12 | Per pasangan unit–garis: `bbi_maks` = maks titik di run itu (toleransi 5e-5), `n_titik` = panjang run | error untuk pasangan yang punya titik; kalau `requireCompleteTrace` dan pasangan tidak punya titik → error |
| V13 | `ringkasan.bbi_maks` = maks semua titik garis itu; `n_excessive`, `n_unacceptable` = hitungan zona titik | error bila `requireCompleteTrace`, kalau tidak dilewati |
| V14 | Arah garis: E harus `dx > 0`, W harus `dx < 0` | error |
| V15 | `pct_bbi_lebih_1` = 100 × (titik > 1) / `n_titik` (toleransi 0,05) | warn |
| V16 | Unit tidak tercakup lebih dari 2% dari N | warn |
| V17 | Ada BBI > 1,0 di unit yang governing-nya `start_of_run` | warn: `"Unit <k>: BBI above 1.0 lies in the first 120 m of a run (straightedge not complete)."` |

Pesan error dan peringatan berbahasa Inggris, menyebut nama berkas dan nomor baris (baris 1 = kepala).

### 5.3 Laporan

`report` berisi: nama dan hash berkas, jumlah baris, cakupan unit, sebaran `lines_measured`, BBI maks runway (unit, garis, zona), jumlah unit > 1,0, jumlah `g_flag` true/false/null, sebaran kelas tampilan (§9), galat maksimum V10, dan selisih maksimum V6/V12/V13.

---

## 6. Fase 1: seed

### 6.1 Skrip `scripts/bbi/build-bbi.mjs`

```
node scripts/bbi/build-bbi.mjs --src data-raw/bbi-06-24-2026 --runway 06-24 --survey 2026-06 \
     --label "Jun 2026" --date 2026-06-28 --lcms 2062903736          # cek saja, cetak laporan
node scripts/bbi/build-bbi.mjs ... --write                           # tulis berkas
```

- Membaca semua `*.csv` di `--src`, menghitung SHA-256 tiap berkas (`node:crypto`), lalu memanggil `buildBbi` dengan `requireCompleteTrace: true` dan `sourceKind: "seed"`.
- Ada error → cetak semuanya, exit 1, tanpa menulis apa pun.
- Dengan `--write`: tulis `public/data/bbi-06-24-2026.json` dan `bbi-06-24-2026-trace.json` (`JSON.stringify` tanpa indentasi, diakhiri `\n`), lalu simpan laporan ke `scripts/bbi/build-bbi-report-2026-11-03.txt`. Pola laporannya sama dengan `scripts/skid/build-skid-1m-report-2026-10-15.txt`.
- Tambahkan ke `package.json`: `"bbi:seed": "node scripts/bbi/build-bbi.mjs --src data-raw/bbi-06-24-2026 --runway 06-24 --survey 2026-06 --label \"Jun 2026\" --date 2026-06-28 --lcms 2062903736 --write"`.
- Kedua JSON di-commit. Folder `data-raw/` tetap di-ignore.

### 6.2 Daftar survei BBI: `src/lib/bbi-surveys.ts`

Salin pola `skid-surveys.ts`:

```ts
export const SEED_BBI_SURVEY_ID = "2026-06";
export interface BbiSurveyRunwayUrls { unitsUrl: string; traceUrl: string; date: string; source: "seed" | "admin" }
export interface BbiSurveyView { id: string; label: string; runways: Partial<Record<RunwayId, BbiSurveyRunwayUrls>> }
export function listBbiSurveys(manifest?: Record<string, BbiSurveyEntry>): BbiSurveyView[];
```

- Seed hanya berisi runway `06-24`: `/data/bbi-06-24-2026.json` dan `/data/bbi-06-24-2026-trace.json`, tanggal `2026-06-28`.
- Runway di manifest menggantikan runway seed pada id yang sama. Urutan daftar: tanggal terbaru dulu.

---

## 7. Tab "Roughness (BBI)"

Semua teks UI berbahasa Inggris. Komponen baru ditaruh di `src/components/bbi/`: `BbiTab.tsx`, `BbiMap.tsx`, `BbiLegend.tsx`, `BbiSummary.tsx`, `BbiProfile.tsx`, `BbiProfileChart.tsx`, `BbiUnitPanel.tsx`, `BbiAbout.tsx`, `bbi-ui.ts`, dan `hover-store.ts` (salinan milik BBI sendiri, bukan impor dari skid). Hook baru: `src/hooks/useBbiSurveys.ts`, `useBbiData.ts`, dan `useBbiTrace.ts`. Helper murni ditaruh di `src/lib/bbi.ts`: `classifyBbi`, `summarizeBbi`, `unitAtX`, `traceX`, dan `decimateMax`.

### 7.1 Pendaftaran tab

- `Home.tsx`: `WorkspaceTab = "pci" | "skid" | "bbi" | "risk"`. Entri baru `{ id: "bbi", label: "Roughness (BBI)", shortLabel: "BBI" }` disisipkan di antara Skid dan Risk. `?tab=bbi` membuka tab ini.
- Ukur ulang `scrollWidth` tab bar dengan label penuh, seperti dijelaskan komentar `NARROW_BREAKPOINT`. Kalau tab bar tidak muat lagi di 800 px, naikkan `NARROW_BREAKPOINT` di `Home.tsx` **dan** `useNarrowViewport.ts`, lalu catat angka hasil ukurnya di komentar.
- Tab memuat data hanya saat dibuka (lazy). Data per unit dan poligon dimuat begitu tab aktif. Data trace dimuat setelahnya, karena profil selalu ada di halaman.

### 7.2 Tata letak (dari atas ke bawah)

1. **Toolbar**
   - Pemilih runway. `RWY 06/24` aktif. `RWY 07L/25R` nonaktif bila survei tidak punya runway itu, dengan tooltip *"No BBI for RWY 07L/25R: the ERD profile was exported at 1 m spacing; BBI needs the 0.25 m profile."*
   - Pemilih survei, hanya tampil bila ada lebih dari satu survei.
2. **Strip ringkasan** (`BbiSummary`)
   - *Max BBI* `1.187`, dengan keterangan `unit 199 · P02_L · Excessive`.
   - *Units above 1.0* `1 of 294`.
   - *Median unit BBI* `0.357`.
   - *Coverage* `294 / 300 units`, dengan keterangan `units 1–3 and 298–300 not covered`.
   - *Lines* `8 (passes 1, 2, 3, 5)`.
3. **Peta** (`BbiMap`, OpenLayers seperti `SkidMap`). Poligon unit 2026 diwarnai menurut kelas `governing.bbi` (§9). Unit tidak tercakup diberi warna *Not covered*. Unit dengan `governing.start_of_run` diberi arsir tipis (pakai `src/lib/hatch-pattern.ts` kalau cocok).
   - Hover menampilkan tooltip `Unit 199 · BBI 1.187 · P02_L · Excessive`.
   - Klik memilih unit dan membuka panel unit.
   - Tidak ada lapisan garis per garis ukur di peta, karena offsetnya masih sementara.
4. **Legenda** (`BbiLegend`). Kelas tampilan beserta jumlah unit, dan satu kalimat: *"Only the 1.0 limit is an FAA criterion (AC 150/5380-9); the bands below 1.0 are display bands."*
5. **Profil** (`BbiProfile` + `BbiProfileChart`, recharts seperti `SkidProfileChart`). Lihat §7.3.
6. **Panel unit** (`BbiUnitPanel`). Panel samping di layar lebar, lembar bawah di layar sempit, seperti skid. Lihat §7.4.
7. **About this data** (`BbiAbout`). Lipatan berisi sumber, metode, koreksi, dan butir §11.

### 7.3 Grafik profil

- **Sumbu.** Sumbu x adalah jarak dari ambang 06, 0–3.000 m, searah nomor unit dan searah sumbu x grafik skid. Sumbu y adalah BBI, mulai dari 0, dengan batas atas `max(1.2, maks terlihat × 1.05)`.
- **Garis batas.** `ReferenceLine` di y = 1,0, putus-putus, berlabel *"Acceptable limit 1.0"*.
- **Mode tampilan.**
  - *One line* (bawaan): garis bawaan adalah garis yang memuat BBI maks runway (P02_L).
  - *Compare*: 2–4 garis.
  - *All lines*: kedelapan garis.
  - Warna per lintasan memakai palet Okabe–Ito: P01 `#0072B2`, P02 `#D55E00`, P03 `#009E73`, P05 `#CC79A7`. Sisi L digambar dengan garis penuh, sisi R putus-putus. Simpan di `src/config/bbi.ts`.
- **Decimation.** Jendela yang terlihat > 600 m digambar sebagai maks per bin 1 m (`decimateMax`), karena puncak harus tetap terlihat. Jendela ≤ 600 m digambar titik 0,25 m apa adanya. Titik `flagged` (Excessive/Unacceptable) **selalu** digambar sebagai titik di atas garis, di semua tingkat zoom.
- **Arsiran (mode One line).**
  - Abu-abu di luar `[x_first, x_last]` garis itu. Tooltip: *"No data: last 250 m of the run removed (profiler braking artefact)"* di ujung tempat lintasan berakhir, dan *"Outside the run"* di ujung lainnya.
  - Arsir tipis pada 120 m pertama lintasan (indeks ≤ `start_of_run_last_i`). Tooltip: *"First 120 m of the run: 120 m straightedge not yet complete"*.
- **Batas unit.** Garis tipis vertikal tiap 10 unit, dan label nomor unit saat zoom ≤ 300 m.
- **Tooltip titik.** Menampilkan jarak dari 06, unit (lewat `unit_runs`), garis, dan BBI. Pada mode bin 1 m, labelnya *"max in 1 m"*.
- **Zoom.** Seret untuk memperbesar, lalu tombol *Reset zoom*. Tombol *Show in profile* di panel unit menyetel jendela ke unit itu ±50 m dengan mode One line pada garis penentunya.
- **Sorot unit.** Unit terpilih diberi `ReferenceArea` tipis. Hover di profil menyorot unit di peta lewat `hover-store`.

### 7.4 Panel unit

Contoh untuk unit 199:

```
Unit 199 · 1,979.7–1,989.9 m from threshold 06
Governing   P02_L · BBI 1.187 · Excessive
            bump height 2.50 cm · bump length 0.50 m · straightedge 2.25 m
G flag      BBI > 1.0 (stored for the SKG consequence axis; not used in Risk yet)

Line   Dir  Offset*  BBI    Zone        H (cm)  L (m)  SE (m)  >1.0   At (m from 06)
P01_L  E    0.0      0.570  Acceptable  4.87    15.00  120.00  0.0%   1,986.5
P01_R  E    0.0      0.366  Acceptable  1.58     3.75   72.25  0.0%   1,988.7
P02_L  W    +5.4     1.187  Excessive   2.50     0.50    2.25  22.5%  1,983.7
P02_R  W    +5.4     0.381  Acceptable  1.80     4.50   65.50  0.0%   1,989.4
P03_L  E    −3.6     0.488  Acceptable  3.40     9.50   44.25  0.0%   1,985.7
P03_R  E    −3.6     0.472  Acceptable  3.60    11.50   75.00  0.0%   1,985.2
P05_L  E    −6.4     0.236  Acceptable  0.76     2.00   11.50  0.0%   1,989.6
P05_R  E    −6.4     0.381  Acceptable  3.11    13.50   71.75  0.0%   1,982.1
* pass offset from pass 1, + = south; provisional
```

- Garis yang tidak melintasi unit ditulis `—` dengan keterangan *"not measured here"*.
- Baris `start_of_run` diberi ikon dan tooltip yang sama dengan §7.3.
- Unit tidak tercakup menampilkan *"Not covered by any processed line (within the trimmed run ends)."*
- Tombol *Show in profile* (§7.3).

### 7.5 URL

Tambahkan `src/lib/bbi-url.ts` dengan pola `skid-url.ts`, beserta ujinya. Kuncinya `survey`, `rw`, `unit`, `line`, `lines`, `view` (`one|compare|all`), dan `x` (`a-b`). Nilai tidak sah diabaikan diam-diam. Pakai `replaceState` seperti skid. Kunci URL tab skid tidak boleh bentrok. Kalau namanya sama (`rw`, `unit`), pastikan berpindah tab membersihkan kunci tab lain. Periksa cara `SKID_URL_KEYS` dipakai di `Home.tsx`, lalu sediakan `BBI_URL_KEYS` dengan cara yang sama.

---

## 8. Fase 2: Admin

### 8.1 Manifest di `DataOverrides`

```ts
export interface BbiSurveyRunwayEntry {
  unitsUrl: string;
  traceUrl: string;
  rawCsv: { role: BbiFileRole; name: string; url: string | null; sha256: string; bytes: number }[];
  date: string;           // "YYYY-MM-DD"
  lines: string[];        // kode garis
  importedAt: string;     // ISO
}
export interface BbiSurveyEntry { id: string; label: string; runways: Partial<Record<RunwayId, BbiSurveyRunwayEntry>> }
// DataOverrides:
bbiSurveys?: Record<string, BbiSurveyEntry>;
```

- Tambahkan `bbiSurveys: parsed.bbiSurveys` ke `normalizeOverrides`. Itu whitelist, jadi tanpa baris ini medannya hilang saat dimuat.
- Tambahkan `upsertBbiSurveyRunway(surveyId, label, runway, entry)` dan `removeBbiSurvey(surveyId)` ke `data-store.tsx`, salinan pola skid. Komentar `...prev, // keeps the year-less fields (repairLog, skidSurveys)` diperbarui supaya ikut menyebut `bbiSurveys`.
- `useBbiSurveys()` = `listBbiSurveys(overrides.bbiSurveys)`.

### 8.2 `api/bbi-files.ts`

Salinan `api/skid-files.ts`. Cek sesi admin tetap disalin dengan sengaja, dan komentar "COPIED ... change one, change all" diperbarui supaya menyebut keempat berkas. Ekspor fungsi murni `bbiUploadRule(pathname, env)`:

- JSON: `^apms/<env>/bbi/[a-z0-9-]{1,40}/(units|trace)-(06-24|07L-25R)-[0-9a-f]{12}\.json$`, `application/json`, maks 5 MB.
- CSV: `^apms/<env>/bbi/[a-z0-9-]{1,40}/raw/[0-9a-f]{12}-[A-Za-z0-9._-]{1,80}\.csv$`, `text/csv`, maks 5 MB.
- Path lain ditolak.

Sebelum menambah function keempat ini, periksa batas jumlah Serverless Function di paket Vercel proyek. Sekarang ada 3: `auth`, `overrides`, `skid-files`.

### 8.3 `src/lib/bbi-upload.ts`

Salinan pola `skid-upload.ts`:

- Direktori Blob: `apms/<env>/bbi/<surveyId>/`.
- Berkas unit `units-<rw>-<hash12>.json`, lalu trace `trace-<rw>-<hash12>.json`. Medan `source_units_file` di trace diisi nama berkas unit **sebelum** trace di-hash.
- CSV `units`, `unit-lines`, dan `lines` diunggah ke `raw/`. CSV `points` **tidak diunggah**, karena 7 MB melewati batas 5 MB. Yang dicatat hanya nama, `sha256`, dan `bytes`-nya, dengan `url: null`.

### 8.4 Panel admin

`Admin.tsx`: `AdminTab` ditambah `"bbi"` dengan label *"Roughness (BBI)"* dan shortLabel *"BBI"*. `YearManager` disembunyikan untuk tab ini.

`src/components/admin/BbiImportPanel.tsx`:

1. **Survey.** Pilih survei yang ada, atau buat baru. Isian survei baru: id `YYYY-MM`, label, tanggal survei, dan LCMS survey id (opsional). Survei seed `2026-06` tampil sebagai *"Jun 2026 (built-in)"*. Mengunggah ke id `2026-06` menggantikan runway seed itu di manifest.
2. **Runway.** `06-24` (N = 300) atau `07L-25R` (N = 360).
3. **Files.** Seret atau pilih keempat `*_web.csv` sekaligus. Batas ukuran: 1 MB untuk `units`/`lines`, 2 MB untuk `unit-lines`, 20 MB untuk `points`. Tabel berkas menampilkan nama, ukuran, peran terdeteksi, dan tombol hapus.
4. **Process.** Memanggil `buildBbi` dengan `requireCompleteTrace: true` dan `sourceKind: "admin-import"`. CSV per titik (86.000 baris) di-parse di main thread. Tampilkan spinner. Kalau UI terasa membeku lebih dari 1 detik, pindahkan ke Web Worker.
5. **Preview.**
   - Daftar error dan peringatan (gaya `IssueList` di `SkidImportPanel`).
   - Isi `report`.
   - Tabel 10 unit dengan BBI tertinggi.
   - Mini-peta tidak perlu.
6. **Save to draft.** Hanya aktif bila tidak ada error. Unggah lewat `bbi-upload.ts`, lalu panggil `upsertBbiSurveyRunway`. Tampilkan toast *"Saved to draft. Press Publish to make it visible."*

`src/components/admin/BbiSurveyList.tsx`: daftar survei di manifest beserta runway, tanggal, jumlah garis, waktu impor, dan tombol *Remove* (dengan konfirmasi). Seed tidak bisa dihapus.

---

## 9. Konfigurasi: `src/config/bbi.ts`

```ts
// Sumber batas 1,0: FAA AC 150/5380-9 (nomor paragraf mengikuti README_BBI_RWY0624.md; cocokkan dengan salinan AC sebelum dikutip di naskah).
export const BBI_LIMIT = 1.0;
export const BBI_START_OF_RUN_M = 120;
export const BBI_TRIMMED_END_M = 250;
// KEPUTUSAN tampilan (bukan kelas FAA): batas bawah inklusif; kelas terakhir di bawah batas memuat 1,0.
export const BBI_DISPLAY_BANDS = [0.2, 0.4, 0.6, 0.8] as const;
export type BbiClass = "b0" | "b1" | "b2" | "b3" | "b4" | "excessive" | "unacceptable" | "noData";
export function classifyBbi(bbi: number | null, zone: BbiZone | null): BbiClass;
```

- Unit ber-zona `Excessive` atau `Unacceptable` masuk kelasnya sendiri, apa pun angkanya.
- `noData` hanya untuk unit tidak tercakup.

| Kelas | Rentang | Warna isi | Warna teks | Jumlah unit (seed) |
|---|---|---|---|---|
| b0 | < 0,2 | `#F1EFE8` | `#2C2C2A` | 13 |
| b1 | 0,2 – < 0,4 | `#D3E4E1` | `#1F3B37` | 173 |
| b2 | 0,4 – < 0,6 | `#9CC5BE` | `#1F3B37` | 91 |
| b3 | 0,6 – < 0,8 | `#5E9E95` | `#FFFFFF` | 11 |
| b4 | 0,8 – 1,0 | `#2F6F67` | `#FFFFFF` | 5 |
| excessive | zona Excessive | `#E8590C` | `#FFFFFF` | 1 |
| unacceptable | zona Unacceptable | `#9B1C1C` | `#FFFFFF` | 0 |
| noData | tidak tercakup | `rgba(140,140,140,0.25)` | `#444441` | 6 |

Ramp teal sengaja berbeda dari skala PCI dan dari ungu skid, sedangkan oranye/merah disisakan untuk zona di atas batas FAA. Cek kontras teks di kedua tema terang dan gelap. Kalau ada yang di bawah 4,5:1, perbaiki warnanya di berkas ini saja.

---

## 10. Uji otomatis

### 10.1 Fixture

Salin folder `fixtures/` di samping brief ini ke `src/lib/__fixtures__/bbi/`:

| Berkas | Isi |
|---|---|
| `bbi_per_unit_web.csv`, `bbi_per_unit_garis_web.csv`, `ringkasan_garis_web.csv` | Salinan utuh, identik byte dengan sumber (hash §3.1) |
| `bbi_per_titik_web_unit198-200.csv` | Kepala + 960 baris titik unit 198–200 (8 garis × 40 titik × 3 unit), SHA-256 `80329947c7b9` |
| `bbi_per_unit_lama_cuplikan.csv` | Kepala + 5 baris `bbi_per_unit.csv` berpenomoran lama, untuk uji penolakan |

### 10.2 Daftar uji

Berkas: `src/lib/bbi-import.test.ts`, `src/lib/bbi.test.ts`, `src/lib/bbi-surveys.test.ts`, `src/lib/bbi-url.test.ts`, `api/bbi-files.test.ts` (atau uji `bbiUploadRule` ditaruh di `src/lib/`, mengikuti tempat uji `skidUploadRule` sekarang), ditambah kasus baru di `src/lib/data-overrides.test.ts`. **Semuanya ditambahkan ke skrip `test` di `package.json`.**

| Uji | Isi |
|---|---|
| A. Pembacaan | `parseDecimal("1,1871") === 1.1871`, `parseDecimal("") === null`, `parseDecimal("abc")` → error. BOM dan LF diterima. `detectRole` untuk kelima fixture, dan fixture lama → `old-numbering` dengan pesan §5.1. |
| B. Penomoran = geometri web | Untuk tiap unit seed tercakup, titik tengah `[x_from_06_start_m, x_from_06_end_m]` dibandingkan dengan proyeksi centroid poligon `runway-06-24-units-2026.json` ke sumbu (unit 1 → unit 300), dengan offset disamakan di unit 1. Selisih maks < 0,5 m (terukur 0,055 m). Unit 1 berada di ujung barat (bujur unit 1 < bujur unit 300). |
| C. Rekonsiliasi | Pada seed: `governing.bbi === max(lines[].bbi_max)`, `lines_measured` = jumlah garis ber-nilai, `n_points` = panjang run di trace, `bbi_max` garis = maks titik run-nya, dan maks tiap garis meta = maks trace garis itu. Pada fixture titik (`requireCompleteTrace: false`): V12 lolos untuk unit 198–200. |
| D. Angka penerimaan | Semua angka §10.3 dari berkas seed. |
| E. Trace | `x0 + (n−1)·dx` sama dengan `x_last_from_06_m` meta (≤ 0,01 m). Tanda `dx` sesuai arah. `unit_runs` kontigu, menutup 0..n−1, dan tanpa unit ganda. Indeks `flagged` bertepatan dengan `bbi > 1`. |
| F. Skema | Kedua berkas seed lolos `BbiRunwaySchema` dan `BbiTraceSchema`. Hasil `buildBbi` dari fixture lolos skema yang sama. |
| G. Error | Membuang satu berkas → error peran hilang. Mengubah satu `unit_web` → V3. Mengubah satu `bbi_maks` garis → V6. Mengganti `;` dengan `,` → error pemisah. |
| H. Kelas | `classifyBbi` di batas: 0,2 → b1; 0,8 → b4; 1,0 → b4; 1,0001 dengan zona Excessive → excessive; null → noData. |
| I. Survei | `listBbiSurveys()` tanpa manifest = seed saja. Manifest dengan id `2026-06` menggantikan runway seed. Survei lebih baru tampil di depan. |
| J. Overrides | `normalizeOverrides` mempertahankan `bbiSurveys`, dan medan tak dikenal tetap dibuang. |
| K. Rule Blob | `bbiUploadRule` menerima path contoh units, trace, dan raw. Path ditolak bila memuat `..`, berhash 11 hex, berunway lain, atau berada di folder `skid/`. |
| L. URL | Pola uji `skid-url.test.ts`: nilai tidak sah diabaikan, dan nilai sah bolak-balik utuh. |

### 10.3 Angka penerimaan (berkas seed 06/24 Juni 2026)

Semua angka di bawah dihitung hari ini dari keempat CSV.

| Besaran | Nilai |
|---|---|
| Unit | 300; tercakup 294; tidak tercakup `[1, 2, 3, 298, 299, 300]` |
| `lines_measured` | 8 → 247 unit (27–273); 6 → 23 (4–26); 4 → 1 (274); 2 → 23 (275–297); 0 → 6 |
| Baris unit–garis | 2.164; `start_of_run` 99 |
| Governing `start_of_run` | 26 unit (4–16 dan 285–297) |
| Zona per unit | Acceptable 293, Excessive 1, Unacceptable 0 |
| BBI maks runway | 1,1871 di unit 199, garis P02_L, Excessive, H 2,50 cm, L 0,50 m, straightedge 2,25 m, 1.983,7 m dari 06, `pct_over_1` 22,5% (9 dari 40 titik) |
| `g_flag` | true 1 (unit 199), false 293, null 6 |
| Statistik BBI unit | median 0,3571, rata-rata 0,38358, minimum 0,1147 (unit 297) |
| Kelas tampilan | b0 13, b1 173, b2 91, b3 11, b4 5, excessive 1, unacceptable 0, noData 6 |
| Garis penentu | P02_L 63, P01_L 47, P03_L 47, P02_R 42, P03_R 28, P01_R 25, P05_L 24, P05_R 18 |
| Ringkasan per garis (rata-rata / maks / unit maks) | P01_L 0,2448 / 0,7277 / 126 · P01_R 0,2201 / 0,7684 / 201 · P02_L 0,2525 / 1,1871 / 199 · P02_R 0,2350 / 0,8465 / 201 · P03_L 0,2451 / 0,8783 / 179 · P03_R 0,2388 / 0,6698 / 201 · P05_L 0,2084 / 0,7889 / 122 · P05_R 0,2184 / 0,6203 / 130 |
| Titik trace | 86.236; zona Acceptable 86.211, Excessive 9 (semuanya P02_L di unit 199, 1.982,41–1.985,66 m dari 06), kosong 16 |
| Panjang sumbu | 2.999,304 m |

---

## 11. Butir "About this data" dan pertanyaan terbuka

Tampilkan di `BbiAbout`. Butir yang masih menunggu surveyor juga dicatat di `processing.caveats`.

1. **Sumber.** Survei LCMS 28 Juni 2026 (ID 2062903736), profil ERD L/R interval 5 mm, BBI dihitung di ProFAA 3.1.0 pada interval 0,25 m, lalu dipetakan ke sample unit dengan `petakan_bbi_0624.m`.
2. **Garis yang diproses.** 8 garis dari lintasan 1, 2, 3, dan 5 dari 22 lintasan. Lintasan 22 tidak dipakai, karena berjalan ke barat tetapi berada di sisi utara (menunggu konfirmasi surveyor).
3. **Bagian yang dibuang dan ditandai.** 250 m terakhir tiap lintasan dibuang, karena artefak profiler saat mengerem. 120 m pertama tiap lintasan ditandai.
4. **Koreksi ekspor ProFAA.** Dua koreksi §4.3. Nilai BBI sendiri dicek mandiri dari profil yang sama dengan korelasi titik demi titik 1,000 (README paket).
5. **Offset sementara.** Jarak jejak roda L–R belum diketahui, dan letak lintasan 1 terhadap as runway belum dipastikan. Offset tidak memengaruhi nomor unit, karena tiap unit selebar runway penuh.
6. **Filter high-pass LCMS** belum diketahui cutoff-nya. AC tidak merekomendasikan profil inertial ber-high-pass untuk BBI (README paket).
7. **RWY 07L/25R** belum punya BBI (§1).
8. **Kedudukan.** Data kondisi fungsional, belum masuk perhitungan risiko. `g_flag` disimpan untuk sumbu G skema SKG.

Nomor paragraf AC yang disebut README paket (par. 2.2f, 2.2g, 2.4, 2.4b) boleh ditampilkan di About. Jangan menambah rujukan atau nomor halaman baru yang tidak ada di README.

---

## 12. Dokumen yang diperbarui

- `docs/brief-bbi-roughness.md`: brief ini disalin ke repo.
- `docs/penomoran-unit.md`, butir paket `BBI_RWY0624`: tambahkan bahwa berkas web `public/data/bbi-06-24-2026*.json` sudah memakai penomoran web (unit 1 di ujung 06), dan bahwa `unit_source` menyimpan nomor lama.
- `README.md`: satu baris tentang tab Roughness (BBI) dan perintah `npm run bbi:seed`.

---

## 13. Urutan kerja dan pemeriksaan

1. Tipe, skema, `bbi-import.ts`, `bbi.ts`, `bbi-surveys.ts`, `src/config/bbi.ts`, fixture, dan uji A, C (fixture), G, H, I. Commit: *"BBI: tipe, skema, modul konversi, dan uji"*.
2. Skrip seed, `npm run bbi:seed`, kedua JSON seed, laporan, dan uji B, C, D, E, F. Laporan harus memuat angka §10.3 persis. Commit: *"BBI: data seed Juni 2026 RWY 06/24 dan skrip pembangun"*.
3. Tab Roughness (BBI), `bbi-url.ts`, dan uji L. Commit: *"BBI: tab Roughness (BBI) dengan peta, profil, dan panel unit"*.
4. Manifest `bbiSurveys`, `api/bbi-files.ts`, `bbi-upload.ts`, panel admin, pemilih survei, dan uji J, K. Commit: *"Admin: unggah CSV BBI, simpan ke Blob, manifest bbiSurveys, pemilih survei"*.
5. Dokumen §12. Commit: *"Docs: brief BBI dan catatan penomoran"*.

Sebelum tiap commit: `npm test`, `npm run build` (`tsc -b` + vite), dan `npm run lint` harus bersih.

**Pemeriksaan manual di browser** (`npm run dev`):

- `?tab=bbi` terbuka, dan tab PCI, Skid, serta Risk tidak berubah tampilan maupun angka.
- Unit 199 berwarna Excessive di peta. Mengekliknya membuka panel dengan isi §7.4.
- *Show in profile* memperbesar ke ±50 m sekitar 1.984 m dan menampilkan 9 titik Excessive.
- Arsir no-data P02_L berada di dekat ujung 06 (x < 262,8 m), dan arsir P01_L di dekat ujung 24 (x > 2.731,0 m).
- Pada viewport 375 px, tab bar dan panel unit tetap terbaca.
- Admin: impor ulang keempat CSV ke survei uji (mis. `2026-07`). Preview menampilkan angka §10.3. Save to draft, lalu Publish di Preview deployment. Pemilih survei muncul di tab, dan survei uji bisa dihapus lagi dari daftar.
