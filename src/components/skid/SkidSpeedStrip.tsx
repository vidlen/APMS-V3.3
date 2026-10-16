import { useMemo } from "react";
import { Line, LineChart, ReferenceArea, Tooltip, XAxis, YAxis } from "recharts";
import { SKID_SPEED } from "@/config/skid";
import type { ProfileRow } from "@/lib/skid-trace";
import { Y_AXIS_WIDTH, profileMargin } from "./skid-ui";

const AXIS = "#555555";
const OUTSIDE = "#D97706";
const LOW = SKID_SPEED.target - SKID_SPEED.tol;
const HIGH = SKID_SPEED.target + SKID_SPEED.tol;

interface SkidSpeedStripProps {
  rows: ProfileRow[];
  /** laneKey() of the lane shown. */
  laneKey: string;
  width: number;
  domain: [number, number];
  syncId?: string;
}

// Test speed along the same x axis as the friction plot. The grey band is the
// FAA tolerance (65 ± 5 km/h); readings outside it are orange (no red/green here).
// ponytail: flags per plotted row, i.e. a 1-2 m average when zoomed out; the run total comes from stats.
export default function SkidSpeedStrip({ rows, laneKey, width, domain, syncId }: SkidSpeedStripProps) {
  const data = useMemo(
    () =>
      rows.map((r) => {
        const v = r[`v_${laneKey}`];
        return { x: r.x, v, out: v !== null && (v < LOW || v > HIGH) ? v : null };
      }),
    [rows, laneKey],
  );

  return (
    <LineChart
      width={width}
      height={72}
      data={data}
      margin={{ ...profileMargin(width), top: 4, bottom: 4 }}
      syncId={syncId}
      syncMethod="value"
    >
      <XAxis type="number" dataKey="x" domain={domain} allowDataOverflow hide />
      <YAxis
        domain={[55, 75]}
        allowDataOverflow
        ticks={[55, 65, 75]}
        tick={{ fontSize: 10, fill: AXIS }}
        width={Y_AXIS_WIDTH}
        stroke={AXIS}
      />
      <ReferenceArea y1={LOW} y2={HIGH} fill="#8A8A8A" fillOpacity={0.18} stroke="none" />
      <Line dataKey="v" stroke="#475569" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
      <Line
        dataKey="out"
        stroke={OUTSIDE}
        strokeWidth={1.5}
        dot={{ r: 1.6, fill: OUTSIDE, stroke: "none" }}
        isAnimationActive={false}
        connectNulls={false}
      />
      <Tooltip content={() => null} cursor={{ stroke: "#26215C", strokeWidth: 1, strokeDasharray: "3 3" }} isAnimationActive={false} />
    </LineChart>
  );
}
