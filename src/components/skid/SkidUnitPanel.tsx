import { useMemo } from "react";
import { X } from "lucide-react";
import { Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { classifySkid, FAA_LINES, LANE_ORDER, SKID_CLASS_META } from "@/config/skid";
import { governingFor, laneMu } from "@/lib/skid";
import { indicesInUnit, unitXRange, xOf } from "@/lib/skid-trace";
import { usePavementData } from "@/hooks/usePavementData";
import { useSkidTrace } from "@/hooks/useSkidTrace";
import type { LaneCode, RunwayId, SkidBasis, SkidRunwayData, SkidRunwayTrace } from "@/types/skid";
import Mu from "./Mu";
import { BASIS_LABEL, RUNWAY_BY_ID, fmtInt, muText, surveyDate, type SelectedUnit } from "./skid-ui";

interface SkidUnitPanelProps {
  data: Record<RunwayId, SkidRunwayData>;
  selected: SelectedUnit | null;
  basis: SkidBasis;
  onClose: () => void;
  /** Open this lane in the friction profile, zoomed to the given x range. */
  onShowInProfile: (lane: LaneCode, domain: [number, number]) => void;
}

// The 1 m readings that make up one sample unit: eight lane rows, each cell
// placed by its x inside the unit and coloured by its class.
function MeterGrid({ rt, unit }: { rt: SkidRunwayTrace; unit: number }) {
  const [x0, x1] = unitXRange(rt, unit);
  const width = x1 - x0;
  return (
    <div className="space-y-px">
      {rt.lanes.map((t) => {
        const idx = indicesInUnit(rt, t, unit);
        return (
          <div key={t.lane} className="flex items-center gap-2">
            <span className="shrink-0 w-[68px] text-[10px] font-mono text-muted-foreground">
              {t.lane} · {idx.length}
            </span>
            <div className="relative flex-1 h-5 bg-secondary/40 overflow-hidden rounded-sm">
              {idx.map((i) => {
                const mu = t.mu[i];
                const cls = classifySkid(mu);
                return (
                  <span
                    key={i}
                    className="absolute inset-y-0 flex items-center justify-center text-[9px] font-mono border-x border-black/20"
                    style={{
                      left: `${((xOf(rt, t, i) - 0.5 - x0) / width) * 100}%`,
                      width: `${(1 / width) * 100}%`,
                      backgroundColor: SKID_CLASS_META[cls].color,
                      color: SKID_CLASS_META[cls].text,
                    }}
                    title={`${t.lane} · DISTANCE ${fmtInt(t.d_first + i)} m · μ ${muText(mu)}`}
                  >
                    {mu === null ? "" : mu.toFixed(2)}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const MUTED = "hsl(var(--muted-foreground))";
const GOVERNING_STROKE = "#FACC15";
const OTHER_BASIS: Record<SkidBasis, SkidBasis> = { "152m": "10m", "10m": "152m" };

// Lanes left to right as seen in the test direction, with a gap at the centre line.
const BAR_ORDER = [...LANE_ORDER.slice(0, 4), "CL", ...LANE_ORDER.slice(4)];

export default function SkidUnitPanel({ data, selected, basis, onClose, onShowInProfile }: SkidUnitPanelProps) {
  const { unitsBySection } = usePavementData("2026");
  // Per-meter readings of the selected unit's runway (cached; loads once a unit is selected).
  const { trace: rt } = useSkidTrace(selected?.runway ?? null);

  const unit = selected ? data[selected.runway].units[selected.unit - 1] : null;
  const g = unit ? governingFor(unit, basis) : null;

  const bars = useMemo(
    () =>
      BAR_ORDER.map((name) => {
        const lane = unit?.lanes.find((l) => l.lane === name);
        const mu = lane ? laneMu(lane, basis) : null;
        return { name, mu, fill: SKID_CLASS_META[classifySkid(mu)].color, governing: g?.lane === name };
      }),
    [unit, basis, g],
  );

  if (!selected || !unit) {
    return <div className="px-5 py-10 text-sm text-muted-foreground text-center">Select a sample unit on the map or heatmap.</div>;
  }

  const rw = RUNWAY_BY_ID[selected.runway];
  const survey = data[selected.runway].survey;
  const cls = classifySkid(g?.mu ?? null);
  const other = governingFor(unit, OTHER_BASIS[basis]);
  const pci = unitsBySection[rw.unitKey]?.features.find((f) => f.properties["sampleUnit"] === selected.unit)?.properties;
  const pciScore = Number(pci?.["pci_score"]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-condensed text-lg font-semibold tracking-tight text-foreground leading-tight">
            {selected.runway.replace("-", "/")} · {selected.unit}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Skid resistance · {survey.speed_kmh} km/h · {surveyDate(survey)} (WIB)
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1 -m-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Clear selected unit"
          title="Clear selection"
        >
          <X size={16} />
        </button>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-mono text-4xl font-bold tabular-nums text-foreground leading-none">{muText(g?.mu)}</span>
          <span
            className="px-2 py-0.5 rounded-sm text-[11px] font-medium border border-border"
            style={{ backgroundColor: SKID_CLASS_META[cls].color, color: SKID_CLASS_META[cls].text }}
          >
            {SKID_CLASS_META[cls].label}
          </span>
        </div>
        {g && (
          <p className="text-xs text-muted-foreground mt-2">
            Governing lane: <span className="font-mono font-medium text-foreground">{g.lane}</span> · Basis: {BASIS_LABEL[basis]}
          </p>
        )}
        {other && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {OTHER_BASIS[basis] === "10m" ? "10 m" : "152 m"}: <span className="font-mono">{muText(other.mu)}</span> ({other.lane})
          </p>
        )}
      </div>

      <div>
        <h4 className="panel-label mb-1">Cross profile · {BASIS_LABEL[basis]}</h4>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 14, right: 30, bottom: 0, left: -12 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: MUTED }} tickLine={false} axisLine={{ stroke: MUTED }} interval={0} />
              <YAxis
                domain={[0.2, 1]}
                ticks={[0.2, 0.4, 0.6, 0.8, 1]}
                allowDataOverflow
                tick={{ fontSize: 10, fill: MUTED }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              {/* A pale halo under each threshold keeps the dark purple lines visible on the dark panel. */}
              {FAA_LINES.map((l) => (
                <ReferenceLine key={`${l.value}-halo`} y={l.value} stroke="rgba(255,255,255,0.55)" strokeWidth={3} />
              ))}
              {FAA_LINES.map((l) => (
                <ReferenceLine
                  key={l.value}
                  y={l.value}
                  stroke={l.color}
                  strokeDasharray={l.dash}
                  strokeWidth={1.5}
                  label={{ value: l.value.toFixed(2), position: "right", fontSize: 9, fill: MUTED }}
                />
              ))}
              <Bar dataKey="mu" isAnimationActive={false} maxBarSize={26}>
                {bars.map((b) => (
                  <Cell
                    key={b.name}
                    fill={b.fill}
                    stroke={b.governing ? GOVERNING_STROKE : "rgba(255,255,255,0.35)"}
                    strokeWidth={b.governing ? 3 : 0.75}
                  />
                ))}
                <LabelList dataKey="mu" position="top" formatter={(v: unknown) => (typeof v === "number" ? v.toFixed(2) : "")} fontSize={9} fill={MUTED} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-[10px] uppercase tracking-[.07em] text-muted-foreground border-b border-border">
            <th className="text-left font-medium py-1.5">Lane</th>
            <th className="text-right font-medium">
              <Mu /> 10 m
            </th>
            <th className="text-right font-medium">
              <Mu /> 152 m
            </th>
            <th className="text-right font-medium">Readings (n)</th>
          </tr>
        </thead>
        <tbody>
          {unit.lanes.map((l) => (
            <tr key={l.lane} className={`hairline-row ${g?.lane === l.lane ? "bg-secondary font-medium" : ""}`}>
              <td className="py-1.5 pl-1 font-mono">{l.lane}</td>
              <td className="text-right font-mono">{muText(l.mu_10m)}</td>
              <td className="text-right font-mono">{muText(l.mu_152m)}</td>
              <td className="text-right font-mono pr-1">{l.mu_10m === null ? "—" : l.n}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {unit.lanes_measured > 0 && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <h4 className="panel-label">Per-meter readings</h4>
            <button
              disabled={!rt || rt.runway !== selected.runway}
              onClick={() => {
                if (!rt) return;
                const [a, b] = unitXRange(rt, selected.unit);
                onShowInProfile(g?.lane ?? unit.lanes.find((l) => l.mu_10m !== null)!.lane, [
                  Math.max(0, a - 150),
                  Math.min(rt.unit_bounds.last_end_m, b + 150),
                ]);
              }}
              className="h-7 px-2.5 rounded-md text-[11px] font-medium border border-border text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:pointer-events-none"
              title="Open this unit in the friction profile"
            >
              Show in profile
            </button>
          </div>
          {rt && rt.runway === selected.runway ? (
            <>
              <MeterGrid rt={rt} unit={selected.unit} />
              {rt.lanes.some((t) =>
                indicesInUnit(rt, t, selected.unit).some((i) => i > 0 && t.mu[i] === t.mu[i - 1] && t.speed_kmh[i] === t.speed_kmh[i - 1]),
              ) && (
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Some 1 m rows repeat the previous reading (device sampling); they are kept, as in the unit average.
                </p>
              )}
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">Loading per-meter readings...</p>
          )}
        </div>
      )}

      <div className="space-y-1.5 text-[11px] text-muted-foreground">
        {unit.lanes_measured === 0 ? (
          <p>This unit lies outside the measured length (≈300 m at each runway end was not recorded).</p>
        ) : (
          unit.lanes_measured < 8 && <p>Partial coverage: {unit.lanes_measured} of 8 lanes cross this unit.</p>
        )}
        {selected.runway === "06-24" && unit.lanes_measured > 0 && (
          <p>Lanes 6.0 m L/R had no GPS; their position uses the median start of the other lanes.</p>
        )}
      </div>

      {Number.isFinite(pciScore) && (
        <p className="text-xs text-muted-foreground border-t border-border pt-3">
          PCI 2026 for this unit:{" "}
          <span className="font-mono font-medium text-foreground">{Math.round(pciScore)}</span>
          {typeof pci?.["pci_rating"] === "string" && <> ({pci["pci_rating"]})</>}
        </p>
      )}
    </div>
  );
}
