import { useMemo } from "react";
import { SKID_CLASS_META, type SkidClass } from "@/config/skid";
import { summarize } from "@/lib/skid";
import type { SkidBasis, SkidRunwayData } from "@/types/skid";
import { BASIS_LABEL, muText, surveyWindow } from "./skid-ui";

const CLASSES: SkidClass[] = ["belowMinimum", "belowMaintenance", "aboveMaintenance", "newDesign"];

interface SkidSummaryProps {
  data: SkidRunwayData;
  basis: SkidBasis;
  onSelectUnit: (unit: number) => void;
}

// One strip of figures for the active runway, in the StatsBar style.
export default function SkidSummary({ data, basis, onSelectUnit }: SkidSummaryProps) {
  const s = useMemo(() => summarize(data, basis), [data, basis]);
  const { first_unit, last_unit, n_units_total } = data.coverage;

  return (
    <div className="px-4 py-3 bg-card border-t border-border">
      <div className="flex flex-wrap items-stretch gap-y-3 divide-x divide-border">
        <div className="flex flex-col gap-1 pr-4">
          <span className="text-[9px] tracking-[.07em] uppercase text-muted-foreground">Measured units</span>
          <span className="font-mono text-lg font-bold text-foreground tabular-nums leading-tight">
            {s.measured} / {n_units_total}
          </span>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            units {first_unit}–{last_unit}
          </span>
        </div>

        <div className="flex flex-col gap-1.5 px-4">
          <span className="text-[9px] tracking-[.07em] uppercase text-muted-foreground">
            Units per class · {BASIS_LABEL[basis]}
          </span>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {CLASSES.map((c) => (
              <li key={c} className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title={SKID_CLASS_META[c].label}>
                <span className="w-2.5 h-2.5 rounded-sm shrink-0 border border-border" style={{ backgroundColor: SKID_CLASS_META[c].color }} />
                <span className="font-mono font-medium text-foreground tabular-nums">{s.counts[c]}</span>
                <span className="hidden xl:inline">{SKID_CLASS_META[c].label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-1 px-4">
          <span className="text-[9px] tracking-[.07em] uppercase text-muted-foreground">Lowest</span>
          {s.lowest ? (
            <button
              onClick={() => onSelectUnit(s.lowest!.unit)}
              className="text-left rounded-sm -m-1 p-1 hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              title="Select this unit"
            >
              <span className="text-sm text-foreground">
                Unit <span className="font-mono font-bold tabular-nums">{s.lowest.unit}</span> ·{" "}
                <span className="font-mono font-bold tabular-nums">{muText(s.lowest.mu)}</span>{" "}
                <span className="text-muted-foreground">({s.lowest.lane})</span>
              </span>
            </button>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </div>

        <div className="flex flex-col gap-1 pl-4">
          <span className="text-[9px] tracking-[.07em] uppercase text-muted-foreground">Survey</span>
          <span className="text-sm text-foreground">{surveyWindow(data.survey)}</span>
        </div>
      </div>
    </div>
  );
}
