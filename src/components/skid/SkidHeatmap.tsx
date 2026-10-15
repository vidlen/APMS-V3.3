import { useMemo, useState, type MouseEvent } from "react";
import { classifySkid, LANE_ORDER, SKID_CLASS_META } from "@/config/skid";
import { governingFor, laneMu } from "@/lib/skid";
import type { SkidBasis, SkidRunwayData } from "@/types/skid";
import { BASIS_LABEL, muText, type RunwayMeta } from "./skid-ui";

const ROW_H = 15;
const GAP = 6; // thin separator before the Governing row
const LANE_ROWS = LANE_ORDER.length;
const GOV_Y = LANE_ROWS * ROW_H + GAP;
const HEIGHT = GOV_Y + ROW_H;
const SELECTED_COLOR = "#FACC15";

const fillOf = (mu: number | null) => SKID_CLASS_META[classifySkid(mu)].color;

interface SkidHeatmapProps {
  data: SkidRunwayData;
  runway: RunwayMeta;
  basis: SkidBasis;
  /** Selected unit on THIS runway, or null. */
  selectedUnit: number | null;
  onSelectUnit: (unit: number) => void;
}

// One cell per (unit, lane) plus a Governing row. Columns follow the physical
// layout: west on the left, so the last unit number is the first column and
// unit 1 the last. Lanes read left-of-centre-line on top (= north on the map).
export default function SkidHeatmap({ data, runway, basis, selectedUnit, onSelectUnit }: SkidHeatmapProps) {
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
    <div className="px-4 py-3 bg-card border-t border-border">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2">
        <h3 className="panel-label">Lane heatmap · {runway.label}</h3>
        <span className="text-[11px] text-muted-foreground">μ per sample unit and lane · {BASIS_LABEL[basis]}</span>
      </div>

      <div className="overflow-x-auto custom-scrollbar">
        <div className="min-w-[640px]">
          <div className="flex gap-2">
            <div className="shrink-0 w-10 text-[10px] font-mono text-muted-foreground text-right" style={{ height: HEIGHT }}>
              {LANE_ORDER.map((l) => (
                <div key={l} style={{ height: ROW_H, lineHeight: `${ROW_H}px` }}>
                  {l}
                </div>
              ))}
              <div style={{ height: GAP }} />
              <div style={{ height: ROW_H, lineHeight: `${ROW_H}px` }}>Gov.</div>
            </div>

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

          {/* Axis: unit numbers every 50, thresholds at both ends. Plain HTML
              so the text does not stretch with the cells. */}
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
      </div>

      {tip && (
        <div className="map-tooltip" style={{ position: "fixed", left: tip.x + 12, top: tip.y - 34 }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
