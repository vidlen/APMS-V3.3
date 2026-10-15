// src/lib/skid-schema.ts — validasi zod untuk kedua jenis berkas skid.
// Anotasi z.ZodType<...> membuat tsc protes kalau skema dan tipe di src/types/skid.ts tidak lagi cocok.
import { z } from "zod";
import { LANE_ORDER } from "../config/skid.ts";
import type { SkidRunwayData, SkidRunwayTrace } from "../types/skid.ts";

const laneCode = z.enum(["L6.0", "L4.5", "L3.0", "L1.5", "R1.5", "R3.0", "R4.5", "R6.0"]);
const runwayId = z.enum(["06-24", "07L-25R"]);
const num = z.number();
const numOrNull = z.number().nullable();
const strOrNull = z.string().nullable();
const governing = z.object({ lane: laneCode, mu: num }).nullable();

const survey = z.object({
  device: z.string(), speed_kmh: num, wetting: z.string(), direction: z.enum(["06", "07L"]),
  start_utc: z.string(), end_utc: z.string(), start_wib: z.string(), end_wib: z.string(),
  measured_length_m: num,
});

export const SkidRunwaySchema: z.ZodType<SkidRunwayData> = z.object({
  schema_version: z.literal(1),
  runway: runwayId,
  unit_numbering: z.string(),
  survey,
  coverage: z.object({ first_unit: num, last_unit: num, n_units: num, n_units_total: num }),
  thresholds: z.object({ minimum: num, maintenance_planning: num, new_design: num, ref: z.string() }),
  basis: z.object({ "10m": z.string(), "152m": z.string() }),
  offset_sign: z.string(),
  position_uncertainty_units: num,
  geometry_source: z.string(),
  lanes: z.array(z.object({
    code: laneCode, side: z.enum(["L", "R"]), offset_m: num, gps: z.boolean(),
    s0_m: num, s0_source: z.string(), record_start_utc: z.string(),
    mean_mu_run: num, mean_speed_kmh: num, file: z.string(),
  })).length(8),
  units: z.array(z.object({
    unit: num, station_start_m: num, station_mid_m: num,
    lanes: z.array(z.object({ lane: laneCode, offset_m: num, mu_10m: numOrNull, n: num, mu_152m: numOrNull })).length(8),
    lanes_measured: num,
    governing_10m: governing,
    governing_152m: governing,
    centroid_lonlat: z.tuple([num, num]),
  })),
});

export const SkidTraceSchema: z.ZodType<SkidRunwayTrace> = z.object({
  schema_version: z.literal(1),
  kind: z.literal("skid-1m"),
  runway: runwayId,
  generated_by: z.string(),
  generated_at: z.string(),
  source_units_file: z.string(),
  survey,
  station_rule: z.string(),
  x_rule: z.string(),
  unit_bounds: z.object({ starts_m: z.array(num), last_end_m: num, window_mid_m: z.array(num) }),
  speed_tolerance_kmh: z.object({ target: num, tol: num, ref: z.string() }),
  reconciliation: z.object({
    unit_lane_pairs: num, n_ok: num, mu_10m_ok: num, mu_152m_ok: num,
    max_abs_diff_10m: num, max_abs_diff_152m: num, edge_cases: z.array(z.string()),
  }),
  lanes: z.array(z.object({
    lane: laneCode, offset_m: num, file: z.string(), s0_m: num, gps: z.boolean(), record_start_utc: z.string(),
    d_first: num, length_m: num, time_first: strOrNull, time_last: strOrNull,
    mu: z.array(numOrNull), speed_kmh: z.array(numOrNull),
    markers: z.array(z.object({ d: num, text: z.string() })),
    stats: z.object({
      rows: num, mu_null: num, speed_null: num, held_rows: num, gps_rows: num,
      mean_mu: numOrNull, mean_speed_kmh: numOrNull, min_speed_kmh: numOrNull, max_speed_kmh: numOrNull,
      rows_outside_speed_tol: num,
    }),
    header: z.object({ length: strOrNull, runway_direction: strOrNull, wetting: strOrNull, friction: strOrNull, speed_kmh: strOrNull }),
  })).length(8),
}).superRefine((d, ctx) => {
  d.lanes.forEach((l, i) => {
    if (l.lane !== LANE_ORDER[i]) ctx.addIssue({ code: "custom", message: `lanes[${i}] is ${l.lane}, expected ${LANE_ORDER[i]}` });
    if (l.mu.length !== l.length_m || l.speed_kmh.length !== l.length_m)
      ctx.addIssue({ code: "custom", message: `${l.lane}: mu/speed length differs from length_m` });
  });
  if (d.unit_bounds.starts_m.length !== d.unit_bounds.window_mid_m.length)
    ctx.addIssue({ code: "custom", message: "unit_bounds arrays differ in length" });
});

/** fetch + validasi. Pesan galat dibuat jelas supaya tab bisa menampilkannya, bukan peta kosong. */
export async function loadJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`${url}: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data;
}
