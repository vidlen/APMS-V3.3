import { CircleMinus, Eye, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { type SkidClass } from "@/config/skid";
import type { Faa320Status } from "@/lib/skid-trace";
import type { LaneCode, RunwayId, SkidBasis, SkidLaneTrace, SkidRunwayTrace, SkidSurvey } from "@/types/skid";

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
export type HeatRes = "unit" | "meter";
export type ProfileView = "one" | "compare" | "all";

/** The lane at the same distance on the other side of the centre line. */
export const mirrorLane = (code: LaneCode): LaneCode => `${code[0] === "L" ? "R" : "L"}${code.slice(1)}` as LaneCode;

export const fmtInt = (n: number): string => Math.round(n).toLocaleString("en-US");

/** Short class labels for table chips. */
export const CLASS_SHORT: Record<SkidClass, string> = {
  belowMinimum: "< 0.50",
  belowMaintenance: "< 0.60",
  aboveMaintenance: "≥ 0.60",
  newDesign: "≥ 0.82",
  noData: "—",
};

// FAA 3-20 flags as shapes and words, not red/yellow/green, so they survive colour-blindness.
export const FAA_STATUS: Partial<Record<Faa320Status, { label: string; ref: string; Icon: LucideIcon }>> = {
  immediate: { label: "Immediate", ref: "3-20.c: below minimum and adjacent segments below maintenance planning", Icon: OctagonAlert },
  extensive: { label: "Extensive", ref: "3-20.b: below maintenance planning over 304.8 m (1,000 ft) or more", Icon: TriangleAlert },
  belowMinimum: { label: "Below min.", ref: "Below minimum, but 3-20.b and 3-20.c are not met", Icon: CircleMinus },
  monitor: { label: "Monitor", ref: "3-20.a: below maintenance planning in a single segment", Icon: Eye },
};

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

/** "6 Jun 2026, 00:29 WIB" from a UTC ISO timestamp (WIB = UTC+7). */
export function wibStamp(utcIso: string): string {
  const d = new Date(Date.parse(utcIso) + 7 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} WIB`;
}

/** "6 Jun 00:21:06" from a UTC ISO timestamp, in WIB (the start times listed in the survey notes). */
export function wibClock(utcIso: string): string {
  const d = new Date(Date.parse(utcIso) + 7 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** "L3.0" -> "3.0 m left of CL" (left/right as seen in the test direction). */
export const laneDescription = (code: LaneCode): string => `${code.slice(1)} m ${code[0] === "L" ? "left" : "right"} of CL`;

/** The two header lines of a one-lane plot (on screen, in the SVG export and on the printed page). */
export function laneHeaderLines(rt: SkidRunwayTrace, runway: RunwayMeta, lane: SkidLaneTrace): [string, string] {
  const wetting = rt.survey.wetting === "On" ? "self-wetting (1 mm)" : `wetting ${rt.survey.wetting}`;
  return [
    `${runway.label} · Lane ${lane.lane} (${laneDescription(lane.lane)}) · Test direction ${rt.survey.direction} · ${wibStamp(lane.record_start_utc)}`,
    `${rt.survey.speed_kmh} km/h · ${wetting} · ${fmtInt(lane.length_m)} m recorded · run mean μ ${muText(lane.stats.mean_mu)} · mean speed ${lane.stats.mean_speed_kmh?.toFixed(1) ?? "—"} km/h`,
  ];
}

export interface Overlays {
  raw: boolean;
  avg: boolean;
  segments: boolean;
  thirds: boolean;
  band: boolean;
}
export const DEFAULT_OVERLAYS: Overlays = { raw: true, avg: true, segments: true, thirds: false, band: false };
export const OVERLAY_LABELS: Record<keyof Overlays, string> = {
  raw: "Raw 1 m",
  avg: "152 m avg",
  segments: "152 m segments",
  thirds: "Thirds",
  band: "±0.06 band",
};

/** Plot margins and y-axis width, shared by the friction plot and the speed strip so they line up. */
export const PROFILE_MARGIN = { top: 28, right: 112, bottom: 38, left: 4 };
export const Y_AXIS_WIDTH = 46;
/** Narrow plots drop the right-hand FAA labels (and their margin) to keep room for the trace. */
export const isCompactPlot = (width: number): boolean => width < 520;
export const profileMargin = (width: number) => (isCompactPlot(width) ? { ...PROFILE_MARGIN, right: 12 } : PROFILE_MARGIN);

/** Visible x range [from, to] in metres along the runway; null = whole runway. */
export type XDomain = [number, number] | null;

/** "6 Jun 2026 · 00:21–02:37 WIB" */
export const surveyWindow = (s: SkidSurvey): string => `${surveyDate(s)} · ${s.start_wib.slice(11)}–${s.end_wib.slice(11)} WIB`;
