// src/types/skid.ts
export type LaneCode = "L6.0" | "L4.5" | "L3.0" | "L1.5" | "R1.5" | "R3.0" | "R4.5" | "R6.0";
export type SkidBasis = "10m" | "152m";
export type RunwayId = "06-24" | "07L-25R";

// ---------- per sample unit: public/data/skid-<runway>-2026.json (sama dengan v1)
export interface SkidLaneValue {
  lane: LaneCode;
  offset_m: number;        // negatif = kiri, positif = kanan terhadap arah uji
  mu_10m: number | null;   // null = lajur tidak melintasi unit ini
  n: number;               // jumlah bacaan 1 m di unit ini (0 kalau null)
  mu_152m: number | null;  // rata-rata 152,4 m berpusat di tengah unit; null kalau mu_10m null
}

export interface SkidUnit {
  unit: number;                       // penomoran web: unit 1 di ujung ambang 06 (RWY 06/24) atau 07L (RWY 07L/25R)
  station_start_m: number;            // dari tepi luar ambang 24 (06/24) atau 25R (07L/25R), sepanjang sumbu runway (2 desimal); menurun menurut nomor unit
  station_mid_m: number;
  lanes: SkidLaneValue[];             // selalu 8, urutan L6.0 ... R6.0
  lanes_measured: number;             // 0..8
  governing_10m: { lane: LaneCode; mu: number } | null;
  governing_152m: { lane: LaneCode; mu: number } | null;
  centroid_lonlat: [number, number];  // untuk uji kecocokan penomoran dan geometri lajur
}

export interface SkidLaneMeta {
  code: LaneCode; side: "L" | "R"; offset_m: number; gps: boolean;
  /** s0_m, record_start_utc, mean_mu_run, mean_speed_kmh: null hanya kalau measured === false. */
  s0_m: number | null; s0_source: string; record_start_utc: string | null;
  mean_mu_run: number | null; mean_speed_kmh: number | null; file: string;
  measured?: boolean;               // tidak ada = true (berkas seed)
}

export interface SkidSurvey {
  device: string; speed_kmh: number; wetting: string; direction: "06" | "07L";
  start_utc: string; end_utc: string; start_wib: string; end_wib: string;
  measured_length_m: number;
}

export interface SkidRunwayData {
  schema_version: 1;
  runway: RunwayId;
  unit_numbering: string;
  survey: SkidSurvey;
  coverage: { first_unit: number; last_unit: number; n_units: number; n_units_total: number };
  thresholds: { minimum: number; maintenance_planning: number; new_design: number; ref: string };
  basis: Record<SkidBasis, string>;
  offset_sign: string;
  position_uncertainty_units: number;
  geometry_source: string;
  lanes: SkidLaneMeta[];
  units: SkidUnit[];
  source?: { kind: "seed" | "admin-import"; imported_at?: string; app_version?: string };
}

// ---------- per meter (BARU di v2): public/data/skid-<runway>-2026-1m.json
export interface SkidTraceStats {
  rows: number;
  mu_null: number;                  // baris FRICTION = NAN
  speed_null: number;
  held_rows: number;                // FRICTION dan SPEED sama persis dengan baris sebelumnya
  gps_rows: number;
  mean_mu: number | null;
  mean_speed_kmh: number | null;
  min_speed_kmh: number | null;
  max_speed_kmh: number | null;
  rows_outside_speed_tol: number;   // |SPEED - 65| > 5 km/j
}

export interface SkidLaneTrace {
  lane: LaneCode;
  offset_m: number;
  file: string;                     // nama CSV asli
  s0_m: number | null;              // sama dengan lanes[].s0_m di berkas per unit; null hanya kalau measured === false
  gps: boolean;
  record_start_utc: string | null;
  measured?: boolean;               // false = lajur tidak diunggah: mu/speed_kmh kosong, length_m = 0
  d_first: number;                  // DISTANCE baris pertama (1)
  length_m: number;                 // jumlah baris (2400 / 3000)
  time_first: string | null;
  time_last: string | null;
  mu: (number | null)[];            // FRICTION per DISTANCE d_first, d_first+1, ...; null = NAN
  speed_kmh: (number | null)[];
  markers: { d: number; text: string }[];
  stats: SkidTraceStats;
  header: { length: string | null; runway_direction: string | null; wetting: string | null; friction: string | null; speed_kmh: string | null };
}

export interface SkidRunwayTrace {
  schema_version: 1;
  kind: "skid-1m";
  runway: RunwayId;
  generated_by: string;
  generated_at: string;
  source_units_file: string;
  survey: SkidSurvey;
  station_rule: string;
  x_rule: string;
  /** Indeks = nomor unit - 1, jadi starts_m dan window_mid_m menurun (stasiun dari ambang 24 / 25R). */
  unit_bounds: { starts_m: number[]; last_end_m: number; window_mid_m: number[] };
  speed_tolerance_kmh: { target: number; tol: number; ref: string };
  reconciliation: {
    unit_lane_pairs: number; n_ok: number; mu_10m_ok: number; mu_152m_ok: number;
    max_abs_diff_10m: number; max_abs_diff_152m: number; edge_cases: string[];
  };
  lanes: SkidLaneTrace[];           // selalu 8, urutan LANE_ORDER
}
