// src/lib/texture-surveys.ts — daftar survei tekstur = survei bawaan (seed Juni 2026, virtual) + manifest admin.
// Murni (tanpa React) supaya bisa diuji dengan node --test. Manifest hanya berisi URL; berkasnya di Vercel Blob.
import type { TextureSurveyEntry } from "./data-overrides.ts";
import type { RunwayId } from "../types/skid.ts";

export const SEED_TEXTURE_SURVEY_ID = "2026-06";

export interface TextureSurveyRunwayUrls {
  url: string;
  date: string; // "YYYY-MM-DD"
  source: "seed" | "admin";
}

export interface TextureSurveyView {
  id: string;
  label: string;
  runways: Partial<Record<RunwayId, TextureSurveyRunwayUrls>>;
}

const SEED_RUNWAYS: Partial<Record<RunwayId, TextureSurveyRunwayUrls>> = {
  "06-24": { url: "/data/texture-06-24-2026.json", date: "2026-06-28", source: "seed" },
  "07L-25R": { url: "/data/texture-07L-25R-2026.json", date: "2026-06-18", source: "seed" },
};

const RUNWAY_IDS: RunwayId[] = ["06-24", "07L-25R"];
const latest = (s: TextureSurveyView) => RUNWAY_IDS.map((r) => s.runways[r]?.date ?? "").sort().pop() ?? "";

/** Seed + manifest, terbaru dulu (menurut tanggal survei). Runway di manifest menggantikan runway seed pada id yang sama. */
export function listTextureSurveys(manifest?: Record<string, TextureSurveyEntry>): TextureSurveyView[] {
  const byId = new Map<string, TextureSurveyView>();
  byId.set(SEED_TEXTURE_SURVEY_ID, { id: SEED_TEXTURE_SURVEY_ID, label: "Jun 2026", runways: { ...SEED_RUNWAYS } });
  for (const e of Object.values(manifest ?? {})) {
    const base = byId.get(e.id) ?? { id: e.id, label: e.label, runways: {} };
    const runways = { ...base.runways };
    for (const rw of RUNWAY_IDS) {
      const r = e.runways[rw];
      if (r) runways[rw] = { url: r.url, date: r.date, source: "admin" };
    }
    byId.set(e.id, { id: e.id, label: e.label || base.label, runways });
  }
  return [...byId.values()].sort((a, b) => latest(b).localeCompare(latest(a)));
}
