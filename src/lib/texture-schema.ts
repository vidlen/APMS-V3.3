// src/lib/texture-schema.ts — validasi zod berkas tekstur.
// Anotasi z.ZodType<...> membuat tsc protes kalau skema dan tipe di src/types/texture.ts tidak lagi cocok.
import { z } from "zod";
import type { TextureRunwayData } from "../types/texture.ts";

const num = z.number();
const numOrNull = z.number().nullable();
const flag = z.boolean().nullable();
const zoneId = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const LANE_COUNT = 120;
const laneSet = z.object({ n: z.array(num).length(LANE_COUNT), mpd_mm: z.array(numOrNull).length(LANE_COUNT) });

export const TextureRunwaySchema: z.ZodType<TextureRunwayData> = z.object({
  schema_version: z.literal(1),
  kind: z.literal("texture-units"),
  runway: z.enum(["06-24", "07L-25R"]),
  survey: z.object({
    id: z.string(), label: z.string(), date: z.string(), lcms_survey_id: z.string().nullable(),
    device: z.string(), package: z.string(),
  }),
  unit_numbering: z.string(),
  axis: z.object({ length_m: num, x_rule: z.string(), station_rule: z.string() }),
  keel: z.object({ half_width_m: num, rule: z.string() }),
  etd: z.object({ a: num, b: num, ref: z.string() }),
  k_rule: z.object({ minimum_mm: num, planning_mm: num, comparator: z.literal("<"), note: z.string() }),
  qc: z.object({
    n_values: num, valid: num, dropout: num, outside: num, turning: num, dropout_pct: num,
    n_segments: num, high_threshold_mm: num, n_high: num, n_high_keel: num,
  }),
  coverage: z.object({ n_units_total: num, n_units_with_keel: num, no_keel: z.array(num) }),
  runway_keel: z.object({ n: num, mpd_mm: num, etd_mm: num }),
  runway_full: z.object({ n: num, mpd_mm: num, etd_mm: num }),
  zones: z.array(z.object({
    zone: zoneId, label: z.string(), units: z.tuple([num, num]), n_keel: num, mpd_mm: num, etd_mm: num,
    n_units_with_keel: num, min_unit: num, min_unit_etd_mm: num, n_units_below_0_76: num, n_units_at_or_above_1_14: num,
  })).length(3),
  lanes: z.object({
    width_m: z.literal(0.5), offset_min_m: z.literal(-30), count: z.literal(LANE_COUNT), rule: z.string(),
    all: laneSet, zone1: laneSet, zone2: laneSet, zone3: laneSet,
  }),
  passes: z.array(z.object({
    pass: num, direction: z.enum(["E", "W"]), n_segments: num, x_start_m: num, x_end_m: num,
    scan_center_offset_m: num, mpd_mm: num, start_time: z.string(),
  })),
  units: z.array(z.object({
    unit: num, zone: zoneId, x_mid_m: num, station_mid_m: num,
    keel: z.object({ n: num, mpd_mm: numOrNull, sd_mm: numOrNull, etd_mm: numOrNull }),
    full: z.object({ n: num, mpd_mm: numOrNull, etd_mm: numOrNull }),
    k_flags: z.object({ minimum: flag, planning: flag }),
    passes: z.array(z.object({ pass: num, n_keel: num })),
    high_values: z.array(z.object({
      segment_id: num, pass: num, band: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
      x_m: num, offset_m: num, mpd_mm: num, keel: z.boolean(), image: z.string(),
    })),
  })),
  processing: z.object({ caveats: z.array(z.string()) }),
  source: z.object({
    kind: z.enum(["seed", "admin-import"]),
    imported_at: z.string().optional(),
    app_version: z.string().optional(),
    files: z.array(z.object({ role: z.enum(["bands", "units-check", "passes", "photo-check"]), name: z.string(), sha256: z.string(), rows: num })),
  }),
}).superRefine((d, ctx) => {
  d.units.forEach((u, i) => {
    if (u.unit !== i + 1) ctx.addIssue({ code: "custom", message: `units[${i}].unit is ${u.unit}, expected ${i + 1}` });
  });
  d.zones.forEach((z, i) => {
    if (z.zone !== i + 1) ctx.addIssue({ code: "custom", message: `zones[${i}].zone is ${z.zone}, expected ${i + 1}` });
  });
});
