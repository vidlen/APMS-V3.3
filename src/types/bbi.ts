// src/types/bbi.ts
import type { RunwayId } from "./skid.ts";

export type BbiZone = "Acceptable" | "Excessive" | "Unacceptable";
export type BbiFileRole = "units" | "unit-lines" | "lines" | "points";

// ---------- per sample unit: public/data/bbi-<runway>-<tahun>.json
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
  line: string;
  bbi: number;
  zone: BbiZone;
  h_cm: number;
  bump_length_m: number;
  straightedge_m: number;
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
    corrections: string[];         // dua koreksi ekspor ProFAA (brief §4.3)
    caveats: string[];             // brief §11
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

// ---------- per titik: public/data/bbi-<runway>-<tahun>-trace.json
export interface BbiLineTrace {
  line: string;
  n: number;                              // jumlah titik
  x0_from_06_m: number;                   // jarak_dari_06 titik ke-0
  dx_m: number;                           // (x_terakhir − x0) / (n − 1); negatif untuk lintasan W
  bbi: number[];                          // 4 desimal, indeks 0..n-1 searah lintasan
  unit_runs: [number, number, number][];  // [unit, i_awal, i_akhir] inklusif, berurutan
  flagged: { i: number; zone: "Excessive" | "Unacceptable" }[];
  null_zone_i: number[];                  // titik dengan zona kosong di CSV
  start_of_run_last_i: number;            // indeks terakhir dengan x_profaa_m < 120; -1 kalau tidak ada
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
