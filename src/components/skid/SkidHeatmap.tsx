import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { classifySkid, LANE_ORDER, SKID_CLASS_META } from "@/config/skid";
import { useElementWidth } from "@/hooks/useElementWidth";
import type { SkidTraceState } from "@/hooks/useSkidTrace";
import { setHover } from "./hover-store";
import { governingFor, laneMu } from "@/lib/skid";
import { laneKey, profileRows, readingAtX, stationOf, unitAtStation, unitXRange, type ProfileRow } from "@/lib/skid-trace";
import type { SkidBasis, SkidRunwayData, SkidRunwayTrace } from "@/types/skid";
import { BASIS_LABEL, fmtInt, muText, type HeatRes, type RunwayMeta, type XDomain } from "./skid-ui";

const ROW_H = 15;
const GAP = 6; // thin separator before the Governing row (per-unit view)
const LANE_ROWS = LANE_ORDER.length;
const GOV_Y = LANE_ROWS * ROW_H + GAP;
const HEIGHT = GOV_Y + ROW_H;
const METER_HEIGHT = LANE_ROWS * ROW_H;
const SELECTED_COLOR = "#FACC15";

const fillOf = (mu: number | null) => SKID_CLASS_META[classifySkid(mu)].color;

function LaneLabels({ withGoverning }: { withGoverning: boolean }) {
  return (
    <div className="shrink-0 w-10 text-[10px] font-mono text-muted-foreground text-right" style={{ height: withGoverning ? HEIGHT : METER_HEIGHT }}>
      {LANE_ORDER.map((l) => (
        <div key={l} style={{ height: ROW_H, lineHeight: `${ROW_H}px` }}>
          {l}
        </div>
      ))}
      {withGoverning && (
        <>
          <div style={{ height: GAP }} />
          <div style={{ height: ROW_H, lineHeight: `${ROW_H}px` }}>Gov.</div>
        </>
      )}
    </div>
  );
}

interface UnitHeatmapProps {
  data: SkidRunwayData;
  runway: RunwayMeta;
  basis: SkidBasis;
  selectedUnit: number | null;
  onSelectUnit: (unit: number) => void;
}

// One cell per (unit, lane) plus a Governing row. Columns follow the physical
// layout: west on the left, so the last unit number is the first column and
// unit 1 the last. Lanes read left-of-centre-line on top (= north on the map).
function UnitHeatmap({ data, runway, basis, selectedUnit, onSelectUnit }: UnitHeatmapProps) {
  const n = data.units.length;
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const cells = useMemo(() => {
    const out: { key: string; x: number; y: number; fill: string }[] = [];
    for (const u of data.units) {
      const x = n - u.unit;
      u.lanes.forEach((l, r) => out.push({ key: `${u.unit}-${r}`, x, y: r * ROW_H, fill: fillOf(laneMu(l, basis)) }));
      out.push({ key: `${u.unit}-g`, x, y: GOV_Y, fill: fillOf(governingFor(u, basis)?.mu ?? null) });
    }
    return out;
  }, [data, basis, n]);

  const locate = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - box.top;
    const col = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * n)));
    const row = y >= 0 && y < LANE_ROWS * ROW_H ? Math.floor(y / ROW_H) : y >= GOV_Y && y < HEIGHT ? LANE_ROWS : null;
    return { unit: n - col, row };
  };

  const describe = (unit: number, row: number | null): string => {
    const u = data.units[unit - 1];
    if (!u.lanes_measured) return `Unit ${unit} · not measured`;
    if (row === null) return `Unit ${unit}`;
    if (row === LANE_ROWS) {
      const g = governingFor(u, basis);
      return g ? `Unit ${unit} · governing ${g.lane} · μ ${muText(g.mu)} (${BASIS_LABEL[basis]})` : `Unit ${unit} · governing — `;
    }
    const l = u.lanes[row];
    return l.mu_10m === null
      ? `Unit ${unit} · ${l.lane} · not measured`
      : `Unit ${unit} · ${l.lane} · 10 m: ${muText(l.mu_10m)} · 152 m: ${muText(l.mu_152m)} · n = ${l.n}`;
  };

  const unitMarks = Array.from({ length: Math.floor(n / 50) }, (_, i) => (i + 1) * 50);

  return (
    <div className="overflow-x-auto custom-scrollbar">
      <div className="min-w-[640px]">
        <div className="flex gap-2">
          <LaneLabels withGoverning />
          <div
            className="relative flex-1 min-w-0 cursor-pointer"
            style={{ height: HEIGHT }}
            onMouseMove={(e) => {
              const { unit, row } = locate(e);
              setTip({ x: e.clientX, y: e.clientY, text: describe(unit, row) });
            }}
            onMouseLeave={() => setTip(null)}
            onClick={(e) => onSelectUnit(locate(e).unit)}
          >
            <svg
              viewBox={`0 0 ${n} ${HEIGHT}`}
              preserveAspectRatio="none"
              width="100%"
              height={HEIGHT}
              shapeRendering="crispEdges"
              role="img"
              aria-label={`Skid resistance heatmap, ${runway.label}, ${n} sample units by 8 lanes`}
            >
              {cells.map((c) => (
                <rect key={c.key} x={c.x} y={c.y} width={1} height={ROW_H} fill={c.fill} />
              ))}
              {selectedUnit !== null && (
                <rect
                  x={n - selectedUnit}
                  y={0}
                  width={1}
                  height={HEIGHT}
                  fill="none"
                  stroke={SELECTED_COLOR}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
          </div>
        </div>

        {/* Axis: unit numbers every 50, thresholds at both ends. Plain HTML so the text does not stretch with the cells. */}
        <div className="relative h-4 ml-12 text-[10px] font-mono text-muted-foreground">
          {unitMarks.map((u) => (
            <span key={u} className="absolute top-0.5 -translate-x-1/2" style={{ left: `${((n - u + 0.5) / n) * 100}%` }}>
              {u}
            </span>
          ))}
        </div>
        <div className="flex justify-between ml-12 text-[10px] uppercase tracking-[.07em] text-muted-foreground">
          <span>Threshold {runway.testEnd}</span>
          <span>Threshold {runway.farEnd}</span>
        </div>
      </div>

      {tip && (
        <div className="map-tooltip" style={{ position: "fixed", left: tip.x + 12, top: tip.y - 34 }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

interface MeterHeatmapProps {
  rt: SkidRunwayTrace;
  ma: NonNullable<SkidTraceState["ma"]>;
  runway: RunwayMeta;
  domain: [number, number];
  selectedUnit: number | null;
  onSelectUnit: (unit: number) => void;
}

/** A tick spacing near span/6 that lands on round numbers. */
function niceStep(span: number): number {
  const raw = span / 6;
  return [5, 10, 20, 50, 100, 200, 250, 500, 1000].find((s) => s >= raw) ?? 1000;
}

// 1 m readings of all eight lanes on one canvas. Each pixel column shows the
// LOWEST reading under it, so a rubber-deposit dip never vanishes when zoomed
// out; at 1 px per metre or more every metre is its own cell.
function MeterHeatmap({ rt, ma, runway, domain, selectedUnit, onSelectUnit }: MeterHeatmapProps) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const span = domain[1] - domain[0];

  const rows = useMemo<ProfileRow[]>(
    () => (width > 0 ? profileRows(rt, rt.lanes, domain, width, ma) : []),
    // `domain` is rebuilt each render; its two ends are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rt, ma, width, domain[0], domain[1]],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(METER_HEIGHT * dpr);
    ctx.scale(dpr, dpr);
    // Not recorded = the "no data" grey; recorded cells are painted over it.
    ctx.fillStyle = SKID_CLASS_META.noData.color;
    ctx.fillRect(0, 0, width, METER_HEIGHT);

    const step = rows.length > 1 ? rows[1].x - rows[0].x : 1;
    const scale = width / span;
    rt.lanes.forEach((t, r) => {
      const key = `lo_${laneKey(t.lane)}`;
      for (const row of rows) {
        const mu = row[key];
        if (mu === null) continue;
        const xa = step === 1 ? row.x : row.x - step / 2; // 1 m rows start at row.x; wider rows are centred
        ctx.fillStyle = fillOf(mu);
        ctx.fillRect((xa - domain[0]) * scale, r * ROW_H, step * scale + 0.6, ROW_H);
      }
    });

    if (selectedUnit !== null) {
      const [a, b] = unitXRange(rt, selectedUnit);
      ctx.strokeStyle = SELECTED_COLOR;
      ctx.lineWidth = 2;
      ctx.strokeRect((a - domain[0]) * scale, 1, Math.max(2, (b - a) * scale), METER_HEIGHT - 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, rows, width, span, domain[0], selectedUnit]);

  const at = (e: MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = domain[0] + ((e.clientX - box.left) / box.width) * span;
    const lane = rt.lanes[Math.min(LANE_ROWS - 1, Math.max(0, Math.floor((e.clientY - box.top) / ROW_H)))];
    return { x, lane };
  };

  const describe = (x: number, lane: SkidRunwayTrace["lanes"][number]): string => {
    // Same bucketing as the cells (and the profile tooltip), so both show the same reading at the same x.
    const i = readingAtX(rt, lane, x, rows.length > 1 ? rows[1].x - rows[0].x : 1);
    if (i === null) return `${lane.lane} · x ${fmtInt(x)} m · not recorded`;
    const unit = unitAtStation(rt, stationOf(lane, i));
    const avg = ma.get(lane.lane)?.[i] ?? null;
    return `${lane.lane} · x ${fmtInt(x)} m · DISTANCE ${fmtInt(lane.d_first + i)} m · Unit ${unit ?? "—"} · μ 1 m ${muText(lane.mu[i])} · 152 m avg ${muText(avg)}`;
  };

  const tickStep = niceStep(span);
  const ticks: number[] = [];
  for (let t = Math.ceil(domain[0] / tickStep) * tickStep; t <= domain[1]; t += tickStep) ticks.push(t);

  return (
    <div>
      <div className="flex gap-2">
        <LaneLabels withGoverning={false} />
        <div ref={wrapRef} className="relative flex-1 min-w-0" style={{ height: METER_HEIGHT }}>
          <canvas
            ref={canvasRef}
            style={{ width, height: METER_HEIGHT, display: "block", cursor: "pointer" }}
            role="img"
            aria-label={`Skid resistance heatmap per metre, ${runway.label}, 8 lanes`}
            onMouseMove={(e) => {
              const { x, lane } = at(e);
              setTip({ x: e.clientX, y: e.clientY, text: describe(x, lane) });
              setHover({ runway: rt.runway, station: rt.unit_bounds.last_end_m - x, offset: lane.offset_m }); // marker on the map
            }}
            onMouseLeave={() => {
              setTip(null);
              setHover(null);
            }}
            onClick={(e) => {
              const unit = unitAtStation(rt, rt.unit_bounds.last_end_m - at(e).x);
              if (unit !== null) onSelectUnit(unit);
            }}
          />
        </div>
      </div>

      <div className="relative h-4 ml-12 text-[10px] font-mono text-muted-foreground">
        {ticks.map((t) => (
          <span key={t} className="absolute top-0.5 -translate-x-1/2" style={{ left: `${((t - domain[0]) / span) * 100}%` }}>
            {fmtInt(t)}
          </span>
        ))}
      </div>
      <p className="ml-12 text-[10px] uppercase tracking-[.07em] text-muted-foreground">
        Distance from {runway.testEnd} end of runway (m) · grey = not recorded · lowest reading per pixel column
      </p>

      {tip && (
        <div className="map-tooltip" style={{ position: "fixed", left: tip.x + 12, top: tip.y - 34 }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

interface SkidHeatmapProps {
  data: SkidRunwayData;
  runway: RunwayMeta;
  basis: SkidBasis;
  res: HeatRes;
  onRes: (res: HeatRes) => void;
  traceState: SkidTraceState;
  /** Visible range of the friction profile; the per-metre heatmap follows it. */
  xDomain: XDomain;
  /** Selected unit on THIS runway, or null. */
  selectedUnit: number | null;
  onSelectUnit: (unit: number) => void;
}

export default function SkidHeatmap({ data, runway, basis, res, onRes, traceState, xDomain, selectedUnit, onSelectUnit }: SkidHeatmapProps) {
  const { trace: rt, ma, loading, error } = traceState;
  const domain: [number, number] = xDomain ?? [0, rt?.unit_bounds.last_end_m ?? 0];

  return (
    <div className="px-4 py-3 bg-card border-t border-border">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="panel-label">Lane heatmap · {runway.label}</h3>
          <span className="text-[11px] text-muted-foreground">
            {res === "unit" ? `μ per sample unit and lane · ${BASIS_LABEL[basis]}` : "μ per 1 m reading · follows the profile zoom"}
          </span>
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={res} onValueChange={(v) => v && onRes(v as HeatRes)}>
          <ToggleGroupItem value="unit">Per unit</ToggleGroupItem>
          <ToggleGroupItem value="meter">Per meter</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {res === "unit" ? (
        <UnitHeatmap data={data} runway={runway} basis={basis} selectedUnit={selectedUnit} onSelectUnit={onSelectUnit} />
      ) : error ? (
        <p className="py-6 text-sm text-center text-muted-foreground break-words">Failed to load per-meter data: {error}</p>
      ) : loading || !rt || !ma ? (
        <p className="py-6 text-sm text-center text-muted-foreground">Loading per-meter readings...</p>
      ) : (
        <MeterHeatmap rt={rt} ma={ma} runway={runway} domain={domain} selectedUnit={selectedUnit} onSelectUnit={onSelectUnit} />
      )}
    </div>
  );
}
