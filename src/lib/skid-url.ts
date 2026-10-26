// src/lib/skid-url.ts — the Skid tab's view state in the query string, so a view can be shared:
//   ?tab=skid&rw=07L-25R&unit=301&lane=L3.0
// No React and no `ol`, so it can be tested with node --test.
import { DEFAULT_SKID_BASIS, LANE_ORDER } from "../config/skid.ts";
import type { LaneCode, RunwayId, SkidBasis } from "../types/skid.ts";

export type ProfileViewParam = "one" | "compare" | "all";

/** Query keys owned by the Skid tab (Home removes them when another tab is shown). */
export const SKID_URL_KEYS = ["survey", "rw", "unit", "lane", "lanes", "basis", "view", "x"] as const;

const UNIT_COUNT: Record<RunwayId, number> = { "06-24": 300, "07L-25R": 360 };
const RUNWAY_IDS = Object.keys(UNIT_COUNT) as RunwayId[];

export interface SkidUrlState {
  /** Survey id; the tab ignores one it does not know. */
  survey?: string;
  runway?: RunwayId;
  unit?: number;
  lane?: LaneCode;
  lanes?: LaneCode[];
  basis?: SkidBasis;
  view?: ProfileViewParam;
  x?: [number, number];
}

const asLane = (s: string): LaneCode | undefined => LANE_ORDER.find((l) => l === s);

/** Reads and validates the Skid keys; anything missing or invalid is simply left out. */
export function parseSkidUrl(search: string): SkidUrlState {
  const p = new URLSearchParams(search);
  const out: SkidUrlState = {};
  const survey = p.get("survey");
  if (survey && /^[a-z0-9-]{1,40}$/.test(survey)) out.survey = survey;
  const rw = RUNWAY_IDS.find((r) => r === p.get("rw"));
  if (rw) out.runway = rw;
  const unit = Number(p.get("unit"));
  if (p.get("unit") !== null && Number.isInteger(unit) && unit >= 1 && unit <= UNIT_COUNT[rw ?? "06-24"]) out.unit = unit;
  const lane = asLane(p.get("lane") ?? "");
  if (lane) out.lane = lane;
  const lanes = [...new Set((p.get("lanes") ?? "").split(",").map(asLane).filter((l): l is LaneCode => l !== undefined))];
  if (lanes.length > 0) out.lanes = lanes;
  const basis = p.get("basis");
  if (basis === "10m" || basis === "152m") out.basis = basis;
  const view = p.get("view");
  if (view === "one" || view === "compare" || view === "all") out.view = view;
  const x = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(p.get("x") ?? "");
  if (x && Number(x[1]) < Number(x[2]) && Number(x[2]) <= 5000) out.x = [Number(x[1]), Number(x[2])];
  return out;
}

export interface SkidUrlInput {
  /** Left out of the URL when it is the default (newest) survey. */
  survey?: string;
  runway: RunwayId;
  unit?: number;
  lane?: LaneCode;
  lanes?: readonly LaneCode[];
  basis: SkidBasis;
  view: ProfileViewParam;
  x: readonly [number, number] | null;
}

/** New query string: the Skid keys replaced from `s` (defaults left out), every other key kept as it was. */
export function skidUrlSearch(currentSearch: string, s: SkidUrlInput): string {
  const p = new URLSearchParams(currentSearch);
  const put = (key: string, value: string | undefined) => (value === undefined ? p.delete(key) : p.set(key, value));
  put("survey", s.survey);
  put("rw", s.runway);
  put("unit", s.unit?.toString());
  put("lane", s.lane);
  put("lanes", s.view === "compare" && s.lanes ? s.lanes.join(",") : undefined);
  put("basis", s.basis === DEFAULT_SKID_BASIS ? undefined : s.basis);
  put("view", s.view === "one" ? undefined : s.view);
  put("x", s.x ? `${Math.round(s.x[0])}-${Math.round(s.x[1])}` : undefined);
  return p.toString().replace(/%2C/g, ","); // commas read better in a shared link
}
