import { useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { FAA_LINES } from "@/config/skid";
import {
  indexAtX,
  laneKey,
  stationOf,
  unitAtStation,
  unitXRange,
  xOf,
  type ProfileRow,
  type SkidSegment,
} from "@/lib/skid-trace";
import type { SkidLaneTrace, SkidRunwayTrace } from "@/types/skid";
import { Y_AXIS_WIDTH, isCompactPlot, profileMargin, type Overlays, type RunwayMeta } from "./skid-ui";

// The profile reads like the vehicle printout, so it sits on a light "paper"
// plot with literal colours (also what the SVG export will carry).
const INK = "#26215C";
const AXIS = "#555555";
const TICK = { fontSize: 10, fill: AXIS };
const SEGMENT = "#D97706";
const THIRD = "#0F766E";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

function xTicks(domain: readonly [number, number]) {
  const [a, b] = domain;
  const compact = b - a < 600;
  const step = compact ? 10 : 100;
  const ticks: number[] = [];
  for (let t = Math.ceil(a / step) * step; t <= b; t += step) ticks.push(t);
  return { ticks, labelStep: compact ? 50 : 500 };
}

/** Top axis: a tick every 10 sample units, labelled every 50 (every 10 when zoomed in). */
function unitTicks(rt: SkidRunwayTrace, domain: readonly [number, number]) {
  const labelEvery = domain[1] - domain[0] < 600 ? 10 : 50;
  const labels = new Map<number, string>();
  const ticks: number[] = [];
  for (let k = 10; k <= rt.unit_bounds.starts_m.length; k += 10) {
    const [a, b] = unitXRange(rt, k);
    const x = (a + b) / 2;
    if (x < domain[0] || x > domain[1]) continue;
    ticks.push(x);
    if (k % labelEvery === 0) labels.set(x, String(k));
  }
  return { ticks: ticks.sort((p, q) => p - q), labels };
}

interface TipProps {
  active?: boolean;
  payload?: { payload: ProfileRow }[];
  rt: SkidRunwayTrace;
  lane: SkidLaneTrace;
}

function ProfileTip({ active, payload, rt, lane }: TipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const k = laneKey(lane.lane);
  const i = indexAtX(rt, lane, row.x);
  const lo = row[`lo_${k}`];
  const hi = row[`hi_${k}`];
  const ma = row[`ma_${k}`];
  const v = row[`v_${k}`];
  const unit = i === null ? null : unitAtStation(rt, stationOf(lane, i));
  const mu = lo === null || hi === null ? "—" : lo === hi ? lo.toFixed(2) : `${lo.toFixed(2)}–${hi.toFixed(2)}`;
  return (
    <div className="rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-800 shadow-md whitespace-nowrap">
      x {fmt(row.x)} m
      {i === null ? (
        " · not recorded"
      ) : (
        <>
          {" "}
          · DISTANCE {fmt(lane.d_first + i)} m · Unit {unit ?? "—"} · μ {mu} (1 m)
          {ma !== null && <> · 152 m avg {ma.toFixed(2)}</>}
          {v !== null && <> · {v.toFixed(1)} km/h</>}
        </>
      )}
    </div>
  );
}

interface SkidProfileChartProps {
  rt: SkidRunwayTrace;
  lane: SkidLaneTrace;
  runway: RunwayMeta;
  rows: ProfileRow[];
  width: number;
  height: number;
  domain: [number, number];
  overlays: Overlays;
  /** Selected unit on this runway, or null. */
  selectedUnit: number | null;
  segments: SkidSegment[];
  thirds: SkidSegment[];
  onZoom: (domain: [number, number]) => void;
  onSelectUnit: (unit: number) => void;
  syncId?: string;
}

// Friction trace of one lane along the runway, left to right in the test direction.
export default function SkidProfileChart({
  rt,
  lane,
  runway,
  rows,
  width,
  height,
  domain,
  overlays,
  selectedUnit,
  segments,
  thirds,
  onZoom,
  onSelectUnit,
  syncId,
}: SkidProfileChartProps) {
  const k = laneKey(lane.lane);
  const [drag, setDrag] = useState<{ a: number; b: number | null } | null>(null);
  const { ticks, labelStep } = xTicks(domain);
  const top = unitTicks(rt, domain);
  const showSegmentLabels = domain[1] - domain[0] <= 1500;

  const startX = xOf(rt, lane, 0) - 0.5;
  const endX = xOf(rt, lane, lane.mu.length - 1) + 0.5;
  const unitRange = selectedUnit === null ? null : unitXRange(rt, selectedUnit);

  // A segment as an x range along the runway, same convention as the table.
  const segX = (s: SkidSegment): [number, number] => [
    xOf(rt, lane, s.dFrom - lane.d_first) - 0.5,
    xOf(rt, lane, s.dTo - lane.d_first) + 0.5,
  ];
  const measured = segments.filter((s) => s.mean !== null);

  const activeX = (state: { activeLabel?: string | number } | null): number | null =>
    state?.activeLabel === undefined ? null : Number(state.activeLabel);

  const finishDrag = () => {
    if (!drag) return;
    const { a, b } = drag;
    setDrag(null);
    if (b !== null && Math.abs(b - a) >= 5) {
      onZoom([Math.min(a, b), Math.max(a, b)]);
      return;
    }
    const unit = unitAtStation(rt, rt.unit_bounds.last_end_m - a);
    if (unit !== null) onSelectUnit(unit);
  };

  // Hatched "Not recorded" ends, clipped to the visible range.
  const unrecorded: [number, number][] = [
    [Math.max(domain[0], 0), Math.min(domain[1], startX)],
    [Math.max(domain[0], endX), Math.min(domain[1], rt.unit_bounds.last_end_m)],
  ];

  return (
    <ComposedChart
      width={width}
      height={height}
      data={rows}
      margin={profileMargin(width)}
      syncId={syncId}
      syncMethod="value"
      style={{ cursor: "crosshair", userSelect: "none" }}
      onMouseDown={(s) => {
        const x = activeX(s);
        if (x !== null) setDrag({ a: x, b: null });
      }}
      onMouseMove={(s) => {
        const x = activeX(s);
        if (drag && x !== null) setDrag({ a: drag.a, b: x });
      }}
      onMouseUp={finishDrag}
      onMouseLeave={() => setDrag(null)}
    >
      <defs>
        <pattern id="skid-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="#EEEDE8" />
          <line x1="0" y1="0" x2="0" y2="7" stroke="#B9B8B0" strokeWidth="2" />
        </pattern>
        <pattern id="skid-band" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#7F77DD" strokeWidth="1.5" strokeOpacity="0.45" />
        </pattern>
      </defs>

      <CartesianGrid stroke="#E6E5DF" vertical={false} />

      <XAxis
        type="number"
        dataKey="x"
        domain={domain}
        allowDataOverflow
        ticks={ticks}
        interval={0}
        tick={TICK}
        tickFormatter={(v: number) => (v % labelStep === 0 ? fmt(v) : "")}
        tickSize={4}
        stroke={AXIS}
        label={{ value: `Distance from ${runway.testEnd} end of runway (m)`, position: "insideBottom", offset: -2, fill: AXIS, fontSize: 11 }}
      />
      <XAxis
        xAxisId="top"
        orientation="top"
        type="number"
        dataKey="x"
        domain={domain}
        allowDataOverflow
        ticks={top.ticks}
        interval={0}
        tick={TICK}
        tickFormatter={(v: number) => top.labels.get(v) ?? ""}
        tickSize={4}
        stroke={AXIS}
      />
      <YAxis
        domain={[0, 1]}
        allowDataOverflow
        ticks={[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]}
        tickFormatter={(v: number) => v.toFixed(1)}
        tick={TICK}
        width={Y_AXIS_WIDTH}
        stroke={AXIS}
        label={{ value: "Friction coefficient μ", angle: -90, position: "insideLeft", offset: 14, fill: AXIS, fontSize: 11, style: { textAnchor: "middle" } }}
      />

      {/* Class backgrounds: below minimum, between minimum and maintenance planning. */}
      <ReferenceArea y1={0} y2={0.5} fill="#3C3489" fillOpacity={0.06} stroke="none" />
      <ReferenceArea y1={0.5} y2={0.6} fill="#7F77DD" fillOpacity={0.06} stroke="none" />
      {overlays.band && <ReferenceArea y1={0.44} y2={0.56} fill="url(#skid-band)" stroke="none" />}
      {overlays.band && <ReferenceArea y1={0.54} y2={0.66} fill="url(#skid-band)" stroke="none" />}

      {unrecorded.map(([x1, x2], i) =>
        x2 > x1 ? (
          <ReferenceArea
            key={i}
            x1={x1}
            x2={x2}
            fill="url(#skid-hatch)"
            stroke="none"
            ifOverflow="hidden"
            label={
              // Skip the label when the hatched band is too narrow to hold it.
              ((x2 - x1) / (domain[1] - domain[0])) * (width - Y_AXIS_WIDTH - profileMargin(width).left - profileMargin(width).right) < 80
                ? undefined
                : { value: "Not recorded", position: "insideTop", fill: "#77766E", fontSize: 10 }
            }
          />
        ) : null,
      )}

      {unitRange && (
        <ReferenceArea
          x1={unitRange[0]}
          x2={unitRange[1]}
          fill="#FACC15"
          fillOpacity={0.25}
          stroke="#B45309"
          strokeWidth={1.5}
          ifOverflow="hidden"
          label={{ value: `Unit ${selectedUnit}`, position: "insideTopRight", fill: "#92400E", fontSize: 10, fontWeight: 600 }}
        />
      )}

      {FAA_LINES.map((l) => (
        <ReferenceLine
          key={l.value}
          y={l.value}
          stroke={l.color}
          strokeDasharray={l.dash || undefined}
          strokeWidth={1.25}
          label={isCompactPlot(width) ? undefined : { value: l.label, position: "right", fill: l.color, fontSize: 9 }}
        />
      ))}

      {/* recharts does not look inside Fragments, so each overlay element is its own conditional. */}
      {overlays.raw && <Line dataKey={`lo_${k}`} stroke="#8A8A8A" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />}
      {overlays.raw && <Line dataKey={`hi_${k}`} stroke="#8A8A8A" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />}
      {overlays.avg && (
        <Line dataKey={`ma_${k}`} stroke={INK} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
      )}

      {overlays.segments &&
        measured.map((s) => {
          const [xa, xb] = segX(s);
          return (
            <ReferenceLine
              key={`seg-${s.index}`}
              ifOverflow="hidden"
              segment={[
                { x: xa, y: s.mean as number },
                { x: xb, y: s.mean as number },
              ]}
              stroke={SEGMENT}
              strokeWidth={2}
              label={showSegmentLabels ? { value: (s.mean as number).toFixed(2), position: "top", fill: "#B45309", fontSize: 10 } : undefined}
            />
          );
        })}
      {overlays.segments &&
        measured.slice(0, -1).map((s, j) => (
          <ReferenceLine
            key={`step-${s.index}`}
            ifOverflow="hidden"
            segment={[
              { x: segX(s)[1], y: s.mean as number },
              { x: segX(s)[1], y: measured[j + 1].mean as number },
            ]}
            stroke={SEGMENT}
            strokeWidth={1.25}
          />
        ))}

      {overlays.thirds &&
        thirds.map((s) =>
          s.mean === null ? null : (
            <ReferenceLine
              key={`third-${s.index}`}
              ifOverflow="hidden"
              segment={[
                { x: segX(s)[0], y: s.mean },
                { x: segX(s)[1], y: s.mean },
              ]}
              stroke={THIRD}
              strokeWidth={2}
              strokeDasharray="7 4"
              label={{ value: `Third ${s.index + 1}: ${s.mean.toFixed(2)}`, position: "insideTop", fill: THIRD, fontSize: 10, fontWeight: 600 }}
            />
          ),
        )}

      {drag && drag.b !== null && <ReferenceArea x1={drag.a} x2={drag.b} fill={INK} fillOpacity={0.14} stroke={INK} strokeOpacity={0.4} ifOverflow="hidden" />}

      <Tooltip
        content={<ProfileTip rt={rt} lane={lane} />}
        isAnimationActive={false}
        cursor={{ stroke: INK, strokeWidth: 1, strokeDasharray: "3 3" }}
      />
    </ComposedChart>
  );
}
