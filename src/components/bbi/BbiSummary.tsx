import { useMemo } from "react";
import { summarizeBbi, unitRanges } from "@/lib/bbi";
import type { BbiRunwayData } from "@/types/bbi";
import { bbiText, joinRanges } from "./bbi-ui";

const LABEL = "text-[9px] tracking-[.07em] uppercase text-muted-foreground";
const VALUE = "font-mono text-lg font-bold text-foreground tabular-nums leading-tight";
const NOTE = "text-[10px] text-muted-foreground tabular-nums";

interface BbiSummaryProps {
  data: BbiRunwayData;
  onSelectUnit: (unit: number) => void;
}

// One strip of figures for the active runway, in the StatsBar style.
export default function BbiSummary({ data, onSelectUnit }: BbiSummaryProps) {
  const s = useMemo(() => summarizeBbi(data), [data]);
  const { n_units_total, n_units_covered, not_covered } = data.coverage;
  const max = s.max;
  const g = max?.governing;

  return (
    <div className="px-4 py-3 bg-card border-t border-border">
      <div className="flex flex-wrap items-stretch gap-y-3 [&>*]:pr-5 [&>*]:mr-5 [&>*:not(:last-child)]:border-r [&>*]:border-border">
        <div className="flex flex-col gap-1">
          <span className={LABEL}>Max BBI</span>
          {max && g ? (
            <button
              onClick={() => onSelectUnit(max.unit)}
              className="text-left rounded-sm -m-1 p-1 hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              title="Select this unit"
            >
              <span className={`block ${VALUE}`}>{bbiText(g.bbi)}</span>
              <span className={NOTE}>
                unit {max.unit} · {g.line} · {g.zone}
              </span>
            </button>
          ) : (
            <span className={VALUE}>—</span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className={LABEL}>Units above 1.0</span>
          <span className={VALUE}>
            {s.aboveLimit} <span className="text-xs font-normal text-muted-foreground">of {s.covered}</span>
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className={LABEL}>Median unit BBI</span>
          <span className={VALUE}>{bbiText(s.median)}</span>
        </div>

        <div className="flex flex-col gap-1">
          <span className={LABEL}>Coverage</span>
          <span className={VALUE}>
            {n_units_covered} / {n_units_total} <span className="text-xs font-normal text-muted-foreground">units</span>
          </span>
          {not_covered.length > 0 && <span className={NOTE}>units {joinRanges(unitRanges(not_covered))} not covered</span>}
        </div>

        <div className="flex flex-col gap-1">
          <span className={LABEL}>Lines</span>
          <span className={VALUE}>{data.lines.length}</span>
          <span className={NOTE}>passes {data.processing.passes_used.join(", ")}</span>
        </div>
      </div>
    </div>
  );
}
