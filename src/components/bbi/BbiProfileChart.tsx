import { useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { BBI_LIMIT } from "@/config/bbi";
import { PROFILE_RAW_WINDOW_M, traceIndexAtX, traceRange, traceX, unitAtX, type BbiProfileRow } from "@/lib/bbi";
import type { BbiLineMeta, BbiLineTrace, BbiUnit } from "@/types/bbi";
import { setHoverUnit } from "./hover-store";
import { START_OF_RUN_HINT, bbiText, fmtInt, fmtX, lineStyle, type BbiRunwayMeta } from "./bbi-ui";

// Like the skid profile, the plot sits on a light "paper" background with literal colours.
const AXIS = "#555555";
const TICK = { fontSize: 10, fill: AXIS };
const INK = "#26215C";
const NO_DATA_FILL = "#DAD9D2";
const Y_AXIS_WIDTH = 44;
/** Unit numbers are labelled from this zoom on. */
const UNIT_LABEL_WINDOW_M = 300;
const NO_DATA_END = "No data: last 250 m of the run removed (profiler braking artefact)";
const NO_DATA_OUTSIDE = "Outside the run";

export interface ChartLine {
  meta: BbiLineMeta;
  trace: BbiLineTrace;
}

function xTicks([a, b]: readonly [number, number]) {
  const span = b - a;
  const step = span <= 150 ? 10 : span <= 600 ? 50 : 100;
  const ticks: number[] = [];
  for (let t = Math.ceil(a / step) * step; t <= b; t += step) ticks.push(t);
  return { ticks, labelStep: span <= 150 ? 20 : span <= 600 ? 100 : 500 };
}

interface TipProps {
  active?: boolean;
  payload?: { payload: BbiProfileRow }[];
  lines: ChartLine[];
  binned: boolean;
  startEnd: string;
}

/** Why a single line has no value at x: the removed end of the run, or before its start. */
function noDataReason(l: ChartLine, x: number): string {
  const [lo, hi] = traceRange(l.trace);
  const atEnd = l.meta.direction === "E" ? x > hi : x < lo;
  return atEnd ? NO_DATA_END : NO_DATA_OUTSIDE;
}

function ProfileTip({ active, payload, lines, binned, startEnd }: TipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const box = "rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-800 shadow-md max-w-[320px]";
  const valueOf = (l: ChartLine) => row[l.meta.code] ?? row[`f_${l.meta.code}`] ?? null;
  const head = (
    <div className="font-medium whitespace-nowrap">
      {fmtX(row.x)} m from {startEnd}
      {binned && lines.some((l) => valueOf(l) !== null) && " · max in 1 m"}
    </div>
  );

  if (lines.length === 1) {
    const l = lines[0];
    const v = valueOf(l);
    if (v === null) {
      return (
        <div className={box}>
          {head}
          {noDataReason(l, row.x)}
        </div>
      );
    }
    const i = traceIndexAtX(l.trace, row.x);
    return (
      <div className={box}>
        {head}
        <div className="whitespace-nowrap">
          Unit {unitAtX(l.trace, row.x) ?? "—"} · {l.meta.code} · BBI {bbiText(v)}
        </div>
        {i !== null && i <= l.trace.start_of_run_last_i && <div>{START_OF_RUN_HINT}</div>}
      </div>
    );
  }
  const unit = lines.map((l) => unitAtX(l.trace, row.x)).find((u) => u !== null);
  return (
    <div className={box}>
      {head}
      {unit !== undefined && <div>Unit {unit}</div>}
      {lines.map((l) => {
        const v = valueOf(l);
        return (
          <div key={l.meta.code} className="whitespace-nowrap">
            <span className="inline-block w-2 h-2 mr-1 rounded-sm" style={{ backgroundColor: lineStyle(l.meta).color }} />
            {l.meta.code} {bbiText(v)}
          </div>
        );
      })}
    </div>
  );
}

interface BbiProfileChartProps {
  lines: ChartLine[];
  units: BbiUnit[];
  runway: BbiRunwayMeta;
  rows: BbiProfileRow[];
  width: number;
  height: number;
  domain: [number, number];
  selectedUnit: BbiUnit | null;
  onZoom: (domain: [number, number]) => void;
  onSelectUnit: (unit: number) => void;
}

// BBI along the runway, left to right from the start threshold, in the direction of the unit numbers.
export default function BbiProfileChart({ lines, units, runway, rows, width, height, domain, selectedUnit, onZoom, onSelectUnit }: BbiProfileChartProps) {
  const [drag, setDrag] = useState<{ a: number; b: number | null } | null>(null);
  const one = lines.length === 1 ? lines[0] : null;
  const span = domain[1] - domain[0];
  const { ticks, labelStep } = xTicks(domain);
  const margin = { top: 28, right: 12, bottom: 38, left: 4 };
  const pxPerM = (width - Y_AXIS_WIDTH - margin.left - margin.right) / span;

  const visibleMax = rows.reduce((max, r) => lines.reduce((m, l) => Math.max(m, r[l.meta.code] ?? 0, r[`f_${l.meta.code}`] ?? 0), max), 0);
  const yMax = Math.max(1.2, visibleMax * 1.05);
  const yTicks = Array.from({ length: Math.ceil(yMax / 0.2) + 1 }, (_, i) => Math.round(i * 2) / 10).filter((t) => t <= yMax);

  // Top axis: unit numbers when zoomed in, thinned out so the labels never collide.
  const unitLabels = span <= UNIT_LABEL_WINDOW_M;
  const labelEvery = pxPerM * 10 >= 26 ? 1 : pxPerM * 10 >= 13 ? 2 : 5;
  const topLabels = new Map<number, string>();
  if (unitLabels) {
    for (const u of units) {
      const mid = (u.x_from_06_start_m + u.x_from_06_end_m) / 2;
      if (mid >= domain[0] && mid <= domain[1] && u.unit % labelEvery === 0) topLabels.set(mid, String(u.unit));
    }
  }
  const boundaries = units.filter((u) => u.unit % 10 === 1).map((u) => u.x_from_06_start_m).filter((x) => x > domain[0] && x < domain[1]);

  const activeX = (state: { activeLabel?: string | number } | null): number | null =>
    state?.activeLabel === undefined ? null : Number(state.activeLabel);
  const unitAt = (x: number) => lines.map((l) => unitAtX(l.trace, x)).find((u) => u !== null) ?? null;

  const finishDrag = () => {
    if (!drag) return;
    const { a, b } = drag;
    setDrag(null);
    if (b !== null && Math.abs(b - a) >= 5) {
      onZoom([Math.min(a, b), Math.max(a, b)]);
      return;
    }
    const unit = unitAt(a);
    if (unit !== null) onSelectUnit(unit);
  };

  // One line view: grey outside the line's data, thin hatch over the first 120 m of its run.
  const range = one ? traceRange(one.trace) : null;
  const startOfRun: [number, number] | null =
    one && one.trace.start_of_run_last_i >= 0
      ? ([traceX(one.trace, 0), traceX(one.trace, one.trace.start_of_run_last_i)].sort((p, q) => p - q) as [number, number])
      : null;

  return (
    <ComposedChart
      width={width}
      height={height}
      data={rows}
      margin={margin}
      style={{ cursor: "crosshair", userSelect: "none" }}
      onMouseDown={(s) => {
        const x = activeX(s);
        if (x !== null) setDrag({ a: x, b: null });
      }}
      onMouseMove={(s) => {
        const x = activeX(s);
        if (x !== null) setHoverUnit(unitAt(x));
        if (drag && x !== null) setDrag({ a: drag.a, b: x });
      }}
      onMouseUp={finishDrag}
      onMouseLeave={() => {
        setDrag(null);
        setHoverUnit(null);
      }}
    >
      <defs>
        <pattern id="bbi-start-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#77766E" strokeWidth="1.25" strokeOpacity="0.5" />
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
        tickFormatter={(v: number) => (v % labelStep === 0 ? fmtInt(v) : "")}
        tickSize={4}
        stroke={AXIS}
        label={{ value: `Distance from threshold ${runway.startEnd} (m)`, position: "insideBottom", offset: -2, fill: AXIS, fontSize: 11 }}
      />
      <XAxis
        xAxisId="top"
        orientation="top"
        type="number"
        dataKey="x"
        domain={domain}
        allowDataOverflow
        hide={!unitLabels}
        ticks={[...topLabels.keys()]}
        interval={0}
        tick={TICK}
        tickFormatter={(v: number) => topLabels.get(v) ?? ""}
        tickSize={4}
        stroke={AXIS}
      />
      <YAxis
        domain={[0, yMax]}
        allowDataOverflow
        ticks={yTicks}
        tickFormatter={(v: number) => v.toFixed(1)}
        tick={TICK}
        width={Y_AXIS_WIDTH}
        stroke={AXIS}
        label={{ value: "Boeing Bump Index", angle: -90, position: "insideLeft", offset: 12, fill: AXIS, fontSize: 11, style: { textAnchor: "middle" } }}
      />

      {range && range[0] > domain[0] && (
        <ReferenceArea x1={domain[0]} x2={Math.min(range[0], domain[1])} fill={NO_DATA_FILL} fillOpacity={0.7} stroke="none" ifOverflow="hidden" />
      )}
      {range && range[1] < domain[1] && (
        <ReferenceArea x1={Math.max(range[1], domain[0])} x2={domain[1]} fill={NO_DATA_FILL} fillOpacity={0.7} stroke="none" ifOverflow="hidden" />
      )}
      {startOfRun && startOfRun[0] < domain[1] && startOfRun[1] > domain[0] && (
        <ReferenceArea x1={Math.max(startOfRun[0], domain[0])} x2={Math.min(startOfRun[1], domain[1])} fill="url(#bbi-start-hatch)" stroke="none" ifOverflow="hidden" />
      )}

      {selectedUnit && (
        <ReferenceArea
          x1={Math.max(selectedUnit.x_from_06_start_m, domain[0])}
          x2={Math.min(selectedUnit.x_from_06_end_m, domain[1])}
          fill="#FACC15"
          fillOpacity={0.25}
          stroke="#B45309"
          strokeWidth={1}
          ifOverflow="hidden"
        />
      )}

      {boundaries.map((x) => (
        <ReferenceLine key={x} x={x} stroke="#C9C8C0" strokeWidth={0.75} ifOverflow="hidden" />
      ))}

      <ReferenceLine
        y={BBI_LIMIT}
        stroke="#9B1C1C"
        strokeDasharray="6 4"
        strokeWidth={1.25}
        label={{ value: "Acceptable limit 1.0", position: "insideTopRight", fill: "#9B1C1C", fontSize: 10 }}
      />

      {lines.map((l) => {
        const s = lineStyle(l.meta);
        return (
          <Line
            key={l.meta.code}
            dataKey={l.meta.code}
            stroke={s.color}
            strokeDasharray={s.dash}
            strokeWidth={span <= PROFILE_RAW_WINDOW_M ? 1.25 : 1}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        );
      })}

      {/* Excessive and Unacceptable points always show as dots, at every zoom level. */}
      {lines
        .filter((l) => l.trace.flagged.length > 0)
        .map((l) => (
          <Line
            key={`f-${l.meta.code}`}
            dataKey={`f_${l.meta.code}`}
            stroke="none"
            dot={{ r: 3, fill: "#E8590C", stroke: "#7C2D12", strokeWidth: 0.75 }}
            activeDot={false}
            legendType="none"
            isAnimationActive={false}
            connectNulls={false}
          />
        ))}

      {drag && drag.b !== null && <ReferenceArea x1={drag.a} x2={drag.b} fill={INK} fillOpacity={0.14} stroke={INK} strokeOpacity={0.4} ifOverflow="hidden" />}

      {/* filterNull off: a row without data still has to reach ProfileTip, which explains why it is empty. */}
      <Tooltip
        filterNull={false}
        content={<ProfileTip lines={lines} binned={span > PROFILE_RAW_WINDOW_M} startEnd={runway.startEnd} />}
        isAnimationActive={false}
        cursor={{ stroke: INK, strokeWidth: 1, strokeDasharray: "3 3" }}
      />
    </ComposedChart>
  );
}
