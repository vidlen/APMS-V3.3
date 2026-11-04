// src/types/texture.ts — format berkas public/data/texture-<runway>-<YYYY>.json (tab Macrotexture).
// Skema zod yang harus cocok dengan tipe ini ada di src/lib/texture-schema.ts.
import type { RunwayId } from "./skid.ts";

export type TextureFileRole = "bands" | "units-check" | "passes" | "photo-check";
export type TextureZoneId = 1 | 2 | 3;

export interface TextureHighValue {
  segment_id: number;
  pass: number;
  band: 1 | 2 | 3 | 4 | 5;
  x_m: number; // jarak_dari_<E1>_m
  offset_m: number; // + = selatan
  mpd_mm: number;
  keel: boolean;
  image: string; // kolom gambar, apa adanya
}

export interface TextureUnit {
  unit: number; // penomoran web, unit 1 di ujung 06 / 07L
  zone: TextureZoneId;
  x_mid_m: number; // jarak_tengah_dari_<E1>_m (1 desimal)
  station_mid_m: number; // round(axis.length_m − x_mid_m, 1), konvensi skid
  keel: { n: number; mpd_mm: number | null; sd_mm: number | null; etd_mm: number | null };
  full: { n: number; mpd_mm: number | null; etd_mm: number | null };
  k_flags: { minimum: boolean | null; planning: boolean | null }; // null = tanpa nilai keel
  passes: { pass: number; n_keel: number }[]; // hanya lintasan dengan n_keel > 0, pass naik
  high_values: TextureHighValue[]; // nilai > 2,0 mm di unit ini, urut x_m lalu band
}

export interface TextureZone {
  zone: TextureZoneId;
  label: string; // "06 end" | "Middle" | "24 end" (07L/25R: "07L end", "Middle", "25R end")
  units: [number, number];
  n_keel: number;
  mpd_mm: number; // rata-rata SEMUA nilai keel zona (bukan rata-rata unit)
  etd_mm: number;
  n_units_with_keel: number;
  min_unit: number; // unit ber-ETD keel terendah; seri -> nomor terkecil
  min_unit_etd_mm: number;
  n_units_below_0_76: number;
  n_units_at_or_above_1_14: number;
}

export interface TextureLaneSet {
  n: number[]; // panjang 120
  mpd_mm: (number | null)[]; // panjang 120
}

export interface TexturePass {
  pass: number;
  direction: "E" | "W"; // E = menuju <E2>
  n_segments: number;
  x_start_m: number;
  x_end_m: number;
  scan_center_offset_m: number;
  mpd_mm: number;
  start_time: string; // "2026-06-28 18:04:48", waktu lokal dari CSV
}

export interface TextureRunwayData {
  schema_version: 1;
  kind: "texture-units";
  runway: RunwayId;
  survey: {
    id: string; // "2026-06"
    label: string; // "Jun 2026"
    date: string; // "2026-06-28"
    lcms_survey_id: string | null; // "2062903736", diambil dari kolom gambar
    device: string;
    package: string;
  };
  unit_numbering: string;
  axis: { length_m: number; x_rule: string; station_rule: string };
  keel: { half_width_m: number; rule: string };
  etd: { a: number; b: number; ref: string }; // ETD = a + b·MPD
  k_rule: { minimum_mm: number; planning_mm: number; comparator: "<"; note: string };
  qc: {
    n_values: number;
    valid: number;
    dropout: number;
    outside: number;
    turning: number;
    dropout_pct: number; // 100·dropout/(valid+dropout), 3 desimal
    n_segments: number;
    high_threshold_mm: number; // 2.0
    n_high: number;
    n_high_keel: number;
  };
  coverage: { n_units_total: number; n_units_with_keel: number; no_keel: number[] };
  runway_keel: { n: number; mpd_mm: number; etd_mm: number };
  runway_full: { n: number; mpd_mm: number; etd_mm: number };
  zones: TextureZone[]; // 3 entri, zona 1..3
  lanes: {
    width_m: 0.5;
    offset_min_m: -30;
    count: 120;
    rule: string;
    all: TextureLaneSet;
    zone1: TextureLaneSet;
    zone2: TextureLaneSet;
    zone3: TextureLaneSet;
  };
  passes: TexturePass[]; // urut pass naik
  units: TextureUnit[]; // panjang = N, units[k-1].unit === k
  processing: { caveats: string[] };
  source: {
    kind: "seed" | "admin-import";
    imported_at?: string;
    app_version?: string;
    files: { role: TextureFileRole; name: string; sha256: string; rows: number }[];
  };
}
