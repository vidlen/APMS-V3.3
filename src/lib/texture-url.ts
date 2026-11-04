// src/lib/texture-url.ts — the Macrotexture tab's view state in the query string, so a view can be shared:
//   ?tab=texture&rw=06-24&unit=14&zone=1&mode=mpd&x=85-185
// No React and no `ol`, so it can be tested with node --test.
import { TEXTURE_UNIT_COUNT } from "../config/texture.ts";
import type { RunwayId } from "../types/skid.ts";
import type { TextureMode, TextureZoneChoice } from "./texture.ts";

/** Query keys owned by the Macrotexture tab. `survey`, `rw`, `unit` and `x` share a name with the Skid and BBI tabs'
 *  keys, so Home clears all three sets on a tab switch (a tab reads its first view from the URL). */
export const TEXTURE_URL_KEYS = ["survey", "rw", "unit", "zone", "mode", "x"] as const;

const RUNWAY_IDS = Object.keys(TEXTURE_UNIT_COUNT) as RunwayId[];

export interface TextureUrlState {
  /** Survey id; the tab ignores one it does not know. */
  survey?: string;
  runway?: RunwayId;
  unit?: number;
  zone?: TextureZoneChoice;
  mode?: TextureMode;
  x?: [number, number];
}

/** Reads and validates the Macrotexture keys; anything missing or invalid is simply left out. */
export function parseTextureUrl(search: string): TextureUrlState {
  const p = new URLSearchParams(search);
  const out: TextureUrlState = {};
  const survey = p.get("survey");
  if (survey && /^[a-z0-9-]{1,40}$/.test(survey)) out.survey = survey;
  const rw = RUNWAY_IDS.find((r) => r === p.get("rw"));
  if (rw) out.runway = rw;
  const unit = Number(p.get("unit"));
  if (p.get("unit") !== null && Number.isInteger(unit) && unit >= 1 && unit <= TEXTURE_UNIT_COUNT[rw ?? "06-24"]) out.unit = unit;
  const zone = p.get("zone");
  if (zone === "all") out.zone = "all";
  if (zone === "1" || zone === "2" || zone === "3") out.zone = Number(zone) as TextureZoneChoice;
  const mode = p.get("mode");
  if (mode === "etd" || mode === "mpd") out.mode = mode;
  const x = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(p.get("x") ?? "");
  if (x && Number(x[1]) < Number(x[2]) && Number(x[2]) <= 5000) out.x = [Number(x[1]), Number(x[2])];
  return out;
}

export interface TextureUrlInput {
  /** Left out of the URL when it is the default (newest) survey. */
  survey?: string;
  runway: RunwayId;
  unit?: number;
  zone: TextureZoneChoice;
  mode: TextureMode;
  x: readonly [number, number] | null;
}

/** New query string: the Macrotexture keys replaced from `s` (defaults left out), every other key kept as it was. */
export function textureUrlSearch(currentSearch: string, s: TextureUrlInput): string {
  const p = new URLSearchParams(currentSearch);
  const put = (key: string, value: string | undefined) => (value === undefined ? p.delete(key) : p.set(key, value));
  put("survey", s.survey);
  put("rw", s.runway);
  put("unit", s.unit?.toString());
  put("zone", s.zone === "all" ? undefined : String(s.zone));
  put("mode", s.mode === "etd" ? undefined : s.mode);
  put("x", s.x ? `${Math.round(s.x[0])}-${Math.round(s.x[1])}` : undefined);
  return p.toString();
}
