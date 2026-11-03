// src/lib/bbi-surveys.ts — daftar survei BBI = survei bawaan (seed Juni 2026, virtual) + manifest admin.
// Murni (tanpa React) supaya bisa diuji dengan node --test. Manifest hanya berisi URL; berkasnya di Vercel Blob.
import type { BbiSurveyEntry } from "./data-overrides.ts";
import type { RunwayId } from "../types/skid.ts";

export const SEED_BBI_SURVEY_ID = "2026-06";

export interface BbiSurveyRunwayUrls {
  unitsUrl: string;
  traceUrl: string;
  date: string; // "YYYY-MM-DD"
  source: "seed" | "admin";
}

export interface BbiSurveyView {
  id: string;
  label: string;
  runways: Partial<Record<RunwayId, BbiSurveyRunwayUrls>>;
}

const SEED_RUNWAYS: Partial<Record<RunwayId, BbiSurveyRunwayUrls>> = {
  "06-24": { unitsUrl: "/data/bbi-06-24-2026.json", traceUrl: "/data/bbi-06-24-2026-trace.json", date: "2026-06-28", source: "seed" },
};

const RUNWAY_IDS: RunwayId[] = ["06-24", "07L-25R"];
const latest = (s: BbiSurveyView) => RUNWAY_IDS.map((r) => s.runways[r]?.date ?? "").sort().pop() ?? "";

/** Seed + manifest, terbaru dulu (menurut tanggal survei). Runway di manifest menggantikan runway seed pada id yang sama. */
export function listBbiSurveys(manifest?: Record<string, BbiSurveyEntry>): BbiSurveyView[] {
  const byId = new Map<string, BbiSurveyView>();
  byId.set(SEED_BBI_SURVEY_ID, { id: SEED_BBI_SURVEY_ID, label: "Jun 2026", runways: { ...SEED_RUNWAYS } });
  for (const e of Object.values(manifest ?? {})) {
    const base = byId.get(e.id) ?? { id: e.id, label: e.label, runways: {} };
    const runways = { ...base.runways };
    for (const rw of RUNWAY_IDS) {
      const r = e.runways[rw];
      if (r) runways[rw] = { unitsUrl: r.unitsUrl, traceUrl: r.traceUrl, date: r.date, source: "admin" };
    }
    byId.set(e.id, { id: e.id, label: e.label || base.label, runways });
  }
  return [...byId.values()].sort((a, b) => latest(b).localeCompare(latest(a)));
}
