import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TEXTURE_LEVELS_MM, TEXTURE_SERIES, TEXTURE_THRESHOLD_LINES } from "@/config/texture";
import { useElementWidth } from "@/hooks/useElementWidth";
import { alongRows, zoneXRange, type TextureAlongRow, type TextureMode, type TextureZoneChoice } from "@/lib/texture";
import type { TextureRunwayData, TextureUnit } from "@/types/texture";
import { setHoverUnit, subscribeHoverUnit } from "./hover-store";
import { fmtInt, fmtX, mmText, type TextureRunwayMeta, type XDomain } from "./texture-ui";

// Like the skid and BBI profiles, the plot sits on a light "paper" background with literal colours.
const AXIS = "#555555";
const TICK = { fontSize: 10, fill: AXIS };
const INK = "#3A2410";
const Y_AXIS_WIDTH = 44;
/** A drag shorter than this is a click. */
const MIN_ZOOM_M = 5;
const UNIT_LENGTH_M = 10;
const btn =
  "h-8 px-3 rounded-md text-xs font-medium border border-border text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:pointer-events-none";

function xTicks([a, b]: readonly [number, number]) {
  const span = b - a;
  const step = span <= 150 ? 10 : span <= 600 ? 50 : 100;
  const ticks: number[] = [];
  for (let t = Math.ceil(a / step) * step; t <= b; t += step) ticks.push(t);
  return { ticks, labelStep: span <= 150 ? 20 : span <= 600 ? 100 : 500 };
}

interface TipProps {
  active?: boolean;
  payload?: { payload: TextureAlongRow }[];
  data: TextureRunwayData;
  startEnd: string;
}

function AlongTip({ active, payload, data, startEnd }: TipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const u: TextureUnit = data.units[row.unit - 1];
  return (
    <div className="rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-800 shadow-md max-w-[320px] tabular-nums">
      <div className="font-medium whitespace-nowrap">
        Unit {u.unit} · {fmtX(u.x_mid_m)} m from {startEnd} · zone {u.zone}
      </div>
      {u.keel.n > 0 ? (
        <>
          <div className="whitespace-nowrap">
            Keel ETD {mmText(u.keel.etd_mm)} mm · MPD {mmText(u.keel.mpd_mm)} mm
          </div>
          <div className="whitespace-nowrap">
            SD {mmText(u.keel.sd_mm)} mm · n {u.keel.n}
          </div>
        </>
      ) : (
        <div>No keel values</div>
      )}
      <div className="whitespace-nowrap">Full width ETD {mmText(u.full.etd_mm)} mm</div>
    </div>
  );
}

interface TextureAlongChartProps {
  data: TextureRunwayData;
  runway: TextureRunwayMeta;
  selectedUnit: TextureUnit | null;
  zone: TextureZoneChoice;
  mode: TextureMode;
  onMode: (mode: TextureMode) => void;
  xDomain: XDomain;
  onXDomain: (domain: XDomain) => void;
  narrow: boolean;
  onSelectUnit: (unit: number) => void;
}

// ETD (or MPD) per unit along the runway, left to right from the start threshold, in the direction of the unit numbers.
export default function TextureAlongChart({ data, runway, selectedUnit, zone, mode, onMode, xDomain, onXDomain, narrow, onSelectUnit }: TextureAlongChartProps) {
  const [plotRef, plotWidth] = useElementWidth<HTMLDivElement>();
  const [drag, setDrag] = useState<{ a: number; b: number | null } | null>(null);
  const [hoverUnit, setHovered] = useState<number | null>(null);
  useEffect(() => subscribeHoverUnit(setHovered), []);

  const length = data.axis.length_m;
  const domain: [number, number] = xDomain ?? [0, length];
  const span = domain[1] - domain[0];
  const rows = useMemo(() => alongRows(data, mode), [data, mode]);
  const visibleMax = rows.reduce((m, r) => (r.x >= domain[0] && r.x <= domain[1] ? Math.max(m, r.keel ?? 0, r.full ?? 0) : m), 0);
  const yMax = Math.max(1.3, visibleMax * 1.05);
  const yTicks = Array.from({ length: Math.ceil(yMax / 0.2) + 1 }, (_, i) => Math.round(i * 2) / 10).filter((t) => t <= yMax);
  const { ticks, labelStep } = xTicks(domain);
  const isEtd = mode === "etd";
  const clamp = (d: [number, number]): XDomain => [Math.max(0, d[0]), Math.min(length, d[1])];

  const activeX = (state: { activeLabel?: string | number } | null): number | null => (state?.activeLabel === undefined ? null : Number(state.activeLabel));
  const unitAt = (x: number) => rows.find((r) => r.x === x)?.unit ?? null;
  const finishDrag = () => {
    if (!drag) return;
    const { a, b } = drag;
    setDrag(null);
    if (b !== null && Math.abs(b - a) >= MIN_ZOOM_M) {
      onXDomain(clamp([Math.min(a, b), Math.max(a, b)]));
      return;
    }
    const unit = unitAt(a);
    if (unit !== null) onSelectUnit(unit);
  };
  const dotR = span <= 600 ? 2.5 : 1.25;
  const pickedZone = zone === "all" ? null : data.zones[zone - 1];
  const pickedRange = pickedZone ? zoneXRange(data, pickedZone) : null;
  const hoverRow = hoverUnit === null ? undefined : data.units[hoverUnit - 1];

  return (
    <div id="texture-along" className="px-4 py-3 bg-card border-t border-border" style={{ scrollMarginTop: 56 }}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-2">
        <h3 className="panel-label">Along the runway · {runway.label}</h3>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-muted-foreground">Drag on the plot to zoom · click to select a unit</span>
          <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && onMode(v as TextureMode)} aria-label="Quantity">
            <ToggleGroupItem value="etd">ETD</ToggleGroupItem>
            <ToggleGroupItem value="mpd">MPD</ToggleGroupItem>
          </ToggleGroup>
          <button onClick={() => onXDomain(null)} disabled={xDomain === null} className={btn}>
            Reset zoom
          </button>
        </div>
      </div>

      {/* The measuring div is always rendered so the observer attaches before the first draw. */}
      <div className="rounded-md bg-[#FBFAF7] text-[#1F1F1F] p-3">
        <div ref={plotRef} className="w-full">
          {plotWidth > 0 && (
            <ComposedChart
              width={plotWidth}
              height={narrow ? 280 : 340}
              data={rows}
              margin={{ top: 12, right: 12, bottom: 38, left: 4 }}
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
              <YAxis
                domain={[0, yMax]}
                allowDataOverflow
                ticks={yTicks}
                tickFormatter={(v: number) => v.toFixed(1)}
                tick={TICK}
                width={Y_AXIS_WIDTH}
                stroke={AXIS}
                label={{ value: `${isEtd ? "ETD" : "MPD"} (mm)`, angle: -90, position: "insideLeft", offset: 12, fill: AXIS, fontSize: 11, style: { textAnchor: "middle" } }}
              />

              {pickedRange && <ReferenceArea x1={Math.max(pickedRange[0], domain[0])} x2={Math.min(pickedRange[1], domain[1])} fill={TEXTURE_SERIES.zone} fillOpacity={0.08} stroke="none" ifOverflow="hidden" />}

              {selectedUnit && (
                <ReferenceArea
                  x1={Math.max(selectedUnit.x_mid_m - UNIT_LENGTH_M / 2, domain[0])}
                  x2={Math.min(selectedUnit.x_mid_m + UNIT_LENGTH_M / 2, domain[1])}
                  fill="#FACC15"
                  fillOpacity={0.35}
                  stroke="#B45309"
                  strokeWidth={1}
                  ifOverflow="hidden"
                />
              )}

              {hoverRow && <ReferenceLine x={hoverRow.x_mid_m} stroke={INK} strokeWidth={1} strokeDasharray="3 3" ifOverflow="hidden" />}

              {isEtd &&
                TEXTURE_THRESHOLD_LINES.map((t) => (
                  <ReferenceLine
                    key={t.y}
                    y={t.y}
                    stroke={t.color}
                    strokeDasharray={t.dash}
                    strokeWidth={1.25}
                    // The units crowd just above 0.76 mm, so that label goes under its line.
                    label={{ value: t.label, position: t.y === TEXTURE_LEVELS_MM.plan ? "insideTopRight" : "insideBottomRight", fill: t.color, fontSize: 10 }}
                  />
                ))}

              {/* One thick segment per zone at its average. */}
              {data.zones.map((z) => {
                const [a, b] = zoneXRange(data, z);
                const y = isEtd ? z.etd_mm : z.mpd_mm;
                if (b <= domain[0] || a >= domain[1]) return null;
                return (
                  <ReferenceLine
                    key={z.zone}
                    segment={[
                      { x: Math.max(a, domain[0]), y },
                      { x: Math.min(b, domain[1]), y },
                    ]}
                    stroke={TEXTURE_SERIES.zone}
                    strokeOpacity={TEXTURE_SERIES.zoneOpacity}
                    strokeWidth={6}
                    ifOverflow="hidden"
                  />
                );
              })}

              <Line dataKey="full" name="Full width" stroke={TEXTURE_SERIES.full} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
              <Line dataKey="keel" name="Keel" stroke={TEXTURE_SERIES.keel} strokeWidth={1.25} dot={{ r: dotR, fill: TEXTURE_SERIES.keel, strokeWidth: 0 }} activeDot={{ r: dotR + 1.5 }} isAnimationActive={false} connectNulls={false} />

              {drag && drag.b !== null && <ReferenceArea x1={drag.a} x2={drag.b} fill={INK} fillOpacity={0.14} stroke={INK} strokeOpacity={0.4} ifOverflow="hidden" />}

              <Tooltip content={<AlongTip data={data} startEnd={runway.startEnd} />} isAnimationActive={false} filterNull={false} cursor={{ stroke: INK, strokeWidth: 1, strokeDasharray: "3 3" }} />
            </ComposedChart>
          )}
        </div>
        {/* On the paper background too: the series colours are chosen for it, not for the dark card. */}
        <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[11px] text-neutral-600">
          <li className="flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden className="shrink-0">
              <line x1="0" y1="4" x2="18" y2="4" stroke={TEXTURE_SERIES.keel} strokeWidth="2" />
              <circle cx="9" cy="4" r="2.5" fill={TEXTURE_SERIES.keel} />
            </svg>
            Keel {isEtd ? "ETD" : "MPD"}
          </li>
          <li className="flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden className="shrink-0">
              <line x1="0" y1="4" x2="18" y2="4" stroke={TEXTURE_SERIES.full} strokeWidth="1.5" />
            </svg>
            Full width {isEtd ? "ETD" : "MPD"}
          </li>
          <li className="flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden className="shrink-0">
              <line x1="0" y1="4" x2="18" y2="4" stroke={TEXTURE_SERIES.zone} strokeOpacity={TEXTURE_SERIES.zoneOpacity} strokeWidth="6" />
            </svg>
            Zone average
          </li>
          {!isEtd && <li className="font-medium">FAA levels apply to ETD.</li>}
        </ul>
      </div>
    </div>
  );
}
