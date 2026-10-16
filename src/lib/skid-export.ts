// src/lib/skid-export.ts — CSV of the 1 m readings visible in the friction profile.
// No React and no `ol`, so it can be tested with node --test.
import { stationOf, unitAtStation, xOf } from "./skid-trace.ts";
import type { LaneCode, SkidRunwayTrace } from "../types/skid.ts";

const num = (v: number | null | undefined, digits: number): string => (v === null || v === undefined ? "" : v.toFixed(digits));

/** One row per 1 m reading of each chosen lane whose x lies inside `domain` (metres from the test-start end).
 *  Lanes come out in LANE_ORDER, each by increasing DISTANCE. `ma` is the 152 m moving average per lane. */
export function profileCsv(
  rt: SkidRunwayTrace,
  laneCodes: readonly LaneCode[],
  domain: readonly [number, number],
  ma: ReadonlyMap<LaneCode, readonly (number | null)[]>,
): string {
  const lines = ["runway,lane,distance_m,x_m,station_m,unit,mu_1m,mu_152m_avg,speed_kmh"];
  for (const t of rt.lanes) {
    if (!laneCodes.includes(t.lane)) continue;
    const avg = ma.get(t.lane);
    for (let i = 0; i < t.mu.length; i++) {
      const x = xOf(rt, t, i);
      if (x < domain[0] || x > domain[1]) continue;
      const station = stationOf(t, i);
      lines.push(
        [rt.runway, t.lane, t.d_first + i, x.toFixed(1), station.toFixed(1), unitAtStation(rt, station) ?? "", num(t.mu[i], 4), num(avg?.[i], 4), num(t.speed_kmh[i], 3)].join(","),
      );
    }
  }
  return lines.join("\n") + "\n";
}

/** File name such as skid-06-24-L3.0-x1000-1500.csv. `lanes` is a label like "L3.0", "L3.0_R3.0" or "all-lanes". */
export const exportName = (runway: string, lanes: string, domain: readonly [number, number], ext: "csv" | "svg"): string =>
  `skid-${runway}-${lanes}-x${Math.round(domain[0])}-${Math.round(domain[1])}.${ext}`;
