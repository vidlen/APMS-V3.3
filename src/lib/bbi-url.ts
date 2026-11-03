// src/lib/bbi-url.ts — the Roughness tab's view state in the query string, so a view can be shared:
//   ?tab=bbi&rw=06-24&unit=199&line=P02_L
// No React and no `ol`, so it can be tested with node --test.
import { BBI_UNIT_COUNT } from "../config/bbi.ts";
import type { RunwayId } from "../types/skid.ts";

export type BbiProfileView = "one" | "compare" | "all";

/** Query keys owned by the Roughness tab. `survey`, `rw`, `unit`, `lines`, `view` and `x` share a name with the
 *  Skid tab's keys, so Home clears both sets on a tab switch (a tab reads its first view from the URL). */
export const BBI_URL_KEYS = ["survey", "rw", "unit", "line", "lines", "view", "x"] as const;

const RUNWAY_IDS = Object.keys(BBI_UNIT_COUNT) as RunwayId[];
const isLine = (s: string) => /^P\d{2}_[LR]$/.test(s);
const MAX_COMPARE = 4;

export interface BbiUrlState {
  /** Survey id; the tab ignores one it does not know. */
  survey?: string;
  runway?: RunwayId;
  unit?: number;
  line?: string;
  lines?: string[];
  view?: BbiProfileView;
  x?: [number, number];
}

/** Reads and validates the Roughness keys; anything missing or invalid is simply left out. */
export function parseBbiUrl(search: string): BbiUrlState {
  const p = new URLSearchParams(search);
  const out: BbiUrlState = {};
  const survey = p.get("survey");
  if (survey && /^[a-z0-9-]{1,40}$/.test(survey)) out.survey = survey;
  const rw = RUNWAY_IDS.find((r) => r === p.get("rw"));
  if (rw) out.runway = rw;
  const unit = Number(p.get("unit"));
  if (p.get("unit") !== null && Number.isInteger(unit) && unit >= 1 && unit <= BBI_UNIT_COUNT[rw ?? "06-24"]) out.unit = unit;
  const line = p.get("line") ?? "";
  if (isLine(line)) out.line = line;
  const lines = [...new Set((p.get("lines") ?? "").split(",").filter(isLine))].slice(0, MAX_COMPARE);
  if (lines.length > 0) out.lines = lines;
  const view = p.get("view");
  if (view === "one" || view === "compare" || view === "all") out.view = view;
  const x = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(p.get("x") ?? "");
  if (x && Number(x[1]) < Number(x[2]) && Number(x[2]) <= 5000) out.x = [Number(x[1]), Number(x[2])];
  return out;
}

export interface BbiUrlInput {
  /** Left out of the URL when it is the default (newest) survey. */
  survey?: string;
  runway: RunwayId;
  unit?: number;
  line?: string;
  lines?: readonly string[];
  view: BbiProfileView;
  x: readonly [number, number] | null;
}

/** New query string: the Roughness keys replaced from `s` (defaults left out), every other key kept as it was. */
export function bbiUrlSearch(currentSearch: string, s: BbiUrlInput): string {
  const p = new URLSearchParams(currentSearch);
  const put = (key: string, value: string | undefined) => (value === undefined ? p.delete(key) : p.set(key, value));
  put("survey", s.survey);
  put("rw", s.runway);
  put("unit", s.unit?.toString());
  put("line", s.view === "one" ? s.line : undefined);
  put("lines", s.view === "compare" && s.lines ? s.lines.join(",") : undefined);
  put("view", s.view === "one" ? undefined : s.view);
  put("x", s.x ? `${Math.round(s.x[0])}-${Math.round(s.x[1])}` : undefined);
  return p.toString().replace(/%2C/g, ","); // commas read better in a shared link
}
