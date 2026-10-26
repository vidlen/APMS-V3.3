// src/lib/skid-surveys.ts — daftar survei skid = survei bawaan (seed Juni 2026, virtual) + manifest admin.
// Murni (tanpa React) supaya bisa diuji dengan node --test. Manifest hanya berisi URL; berkasnya di Vercel Blob.
import type { SkidSurveyEntry } from "./data-overrides.ts";
import type { RunwayId } from "../types/skid.ts";

export const SEED_SKID_SURVEY_ID = "2026-06";

export interface SkidSurveyRunwayUrls {
  unitsUrl: string;
  traceUrl: string;
  startWib: string; // "YYYY-MM-DD HH:mm"
  source: "seed" | "admin";
}

export interface SkidSurveyView {
  id: string;
  label: string;
  runways: Partial<Record<RunwayId, SkidSurveyRunwayUrls>>;
}

const SEED_RUNWAYS: Record<RunwayId, SkidSurveyRunwayUrls> = {
  "06-24": { unitsUrl: "/data/skid-06-24-2026.json", traceUrl: "/data/skid-06-24-2026-1m.json", startWib: "2026-06-06 00:21", source: "seed" },
  "07L-25R": { unitsUrl: "/data/skid-07L-25R-2026.json", traceUrl: "/data/skid-07L-25R-2026-1m.json", startWib: "2026-06-15 00:12", source: "seed" },
};

const RUNWAY_IDS: RunwayId[] = ["06-24", "07L-25R"];
const latest = (s: SkidSurveyView) => RUNWAY_IDS.map((r) => s.runways[r]?.startWib ?? "").sort().pop() ?? "";

/** Seed + manifest, terbaru dulu (menurut waktu mulai terbaru). Runway di manifest menggantikan runway seed pada id yang sama. */
export function listSkidSurveys(manifest?: Record<string, SkidSurveyEntry>): SkidSurveyView[] {
  const byId = new Map<string, SkidSurveyView>();
  byId.set(SEED_SKID_SURVEY_ID, { id: SEED_SKID_SURVEY_ID, label: "Jun 2026", runways: { ...SEED_RUNWAYS } });
  for (const e of Object.values(manifest ?? {})) {
    const base = byId.get(e.id) ?? { id: e.id, label: e.label, runways: {} };
    const runways = { ...base.runways };
    for (const rw of RUNWAY_IDS) {
      const r = e.runways[rw];
      if (r) runways[rw] = { unitsUrl: r.unitsUrl, traceUrl: r.traceUrl, startWib: r.startWib, source: "admin" };
    }
    byId.set(e.id, { id: e.id, label: e.label || base.label, runways });
  }
  return [...byId.values()].sort((a, b) => latest(b).localeCompare(latest(a)));
}
