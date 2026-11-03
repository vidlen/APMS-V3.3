// src/lib/bbi-schema.ts — validasi zod untuk kedua jenis berkas BBI.
// Anotasi z.ZodType<...> membuat tsc protes kalau skema dan tipe di src/types/bbi.ts tidak lagi cocok.
import { z } from "zod";
import type { BbiRunwayData, BbiRunwayTrace } from "../types/bbi.ts";

const runwayId = z.enum(["06-24", "07L-25R"]);
const num = z.number();
const numOrNull = z.number().nullable();
const zone = z.enum(["Acceptable", "Excessive", "Unacceptable"]);

export const BbiRunwaySchema: z.ZodType<BbiRunwayData> = z.object({
  schema_version: z.literal(1),
  kind: z.literal("bbi-units"),
  runway: runwayId,
  survey: z.object({
    id: z.string(), label: z.string(), date: z.string(), lcms_survey_id: z.string().nullable(),
    device: z.string(), software: z.string(), output_spacing_m: num,
  }),
  unit_numbering: z.string(),
  axis: z.object({ length_m: num, x_rule: z.string(), station_rule: z.string() }),
  thresholds: z.object({ acceptable_max: z.literal(1), ref: z.string() }),
  g_rule: z.object({ threshold: z.literal(1), comparator: z.literal(">"), note: z.string() }),
  processing: z.object({
    passes_used: z.array(num), trimmed_end_m: num, start_of_run_m: num,
    corrections: z.array(z.string()), caveats: z.array(z.string()),
  }),
  coverage: z.object({ n_units_total: num, n_units_covered: num, not_covered: z.array(num) }),
  lines: z.array(z.object({
    code: z.string().regex(/^P\d{2}_[LR]$/), source_name: z.string(), pass: num,
    side: z.enum(["L", "R"]), direction: z.enum(["E", "W"]),
    offset_m: num, offset_status: z.literal("provisional"),
    bbi_mean: num, bbi_max: num, max_unit: num, max_x_from_06_m: num,
    n_excessive: num, n_unacceptable: num, x_first_from_06_m: num, x_last_from_06_m: num,
  })).min(1),
  units: z.array(z.object({
    unit: num, unit_source: num,
    x_from_06_start_m: num, x_from_06_end_m: num, station_from_24_start_m: num, station_from_24_end_m: num,
    lines_measured: num,
    governing: z.object({
      line: z.string(), bbi: num, zone, h_cm: num, bump_length_m: num, straightedge_m: num, start_of_run: z.boolean(),
    }).nullable(),
    lines: z.array(z.object({
      line: z.string(), bbi_max: numOrNull, zone: zone.nullable(), h_cm: numOrNull, bump_length_m: numOrNull,
      straightedge_m: numOrNull, x_from_06_m: numOrNull, x_profaa_m: numOrNull, pct_over_1: numOrNull,
      n_points: num, start_of_run: z.boolean(),
    })),
    g_flag: z.boolean().nullable(),
  })),
  source: z.object({
    kind: z.enum(["seed", "admin-import"]),
    imported_at: z.string().optional(),
    app_version: z.string().optional(),
    files: z.array(z.object({ role: z.enum(["units", "unit-lines", "lines", "points"]), name: z.string(), sha256: z.string(), rows: num })),
  }),
}).superRefine((d, ctx) => {
  const codes = d.lines.map((l) => l.code).join();
  d.units.forEach((u, i) => {
    if (u.unit !== i + 1) ctx.addIssue({ code: "custom", message: `units[${i}].unit is ${u.unit}, expected ${i + 1}` });
    if (u.lines.map((l) => l.line).join() !== codes) ctx.addIssue({ code: "custom", message: `units[${i}].lines differ from the meta lines` });
  });
});

export const BbiTraceSchema: z.ZodType<BbiRunwayTrace> = z.object({
  schema_version: z.literal(1),
  kind: z.literal("bbi-trace"),
  runway: runwayId,
  survey_id: z.string(),
  source_units_file: z.string(),
  spacing_profaa_m: num,
  x_rule: z.string(),
  lines: z.array(z.object({
    line: z.string(), n: num, x0_from_06_m: num, dx_m: num,
    bbi: z.array(num),
    unit_runs: z.array(z.tuple([num, num, num])),
    flagged: z.array(z.object({ i: num, zone: z.enum(["Excessive", "Unacceptable"]) })),
    null_zone_i: z.array(num),
    start_of_run_last_i: num,
  })).min(1),
}).superRefine((d, ctx) => {
  d.lines.forEach((l) => {
    if (l.bbi.length !== l.n) ctx.addIssue({ code: "custom", message: `${l.line}: bbi length ${l.bbi.length} differs from n ${l.n}` });
  });
});
