import type { RunwayId, SkidBasis, SkidSurvey } from "@/types/skid";

export interface RunwayMeta {
  id: RunwayId;
  label: string;
  /** Key in SEED_SAMPLE_UNIT_SOURCES (the PCI unit files). */
  unitKey: string;
  /** Threshold the test started from (x = 0 on profile axes), and the far one. */
  testEnd: string;
  farEnd: string;
}

export const RUNWAYS: RunwayMeta[] = [
  { id: "06-24", label: "RWY 06/24", unitKey: "06/24", testEnd: "06", farEnd: "24" },
  { id: "07L-25R", label: "RWY 07L/25R", unitKey: "07L/25R", testEnd: "07L", farEnd: "25R" },
];

export const RUNWAY_BY_ID = Object.fromEntries(RUNWAYS.map((r) => [r.id, r])) as Record<RunwayId, RunwayMeta>;

export type MapLanes = "off" | "unit" | "meter";

export interface SelectedUnit {
  runway: RunwayId;
  unit: number;
}

export const BASIS_LABEL: Record<SkidBasis, string> = { "152m": "152 m (FAA)", "10m": "10 m" };

export const muText = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : v.toFixed(2));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// survey.start_wib / end_wib are "YYYY-MM-DD HH:mm" strings already in WIB.
/** "6 Jun 2026" */
export function surveyDate(s: SkidSurvey): string {
  const [y, m, d] = s.start_wib.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "6 Jun 2026 · 00:21–02:37 WIB" */
export const surveyWindow = (s: SkidSurvey): string => `${surveyDate(s)} · ${s.start_wib.slice(11)}–${s.end_wib.slice(11)} WIB`;
