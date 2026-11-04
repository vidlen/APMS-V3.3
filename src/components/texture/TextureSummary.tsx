import { useMemo } from "react";
import type { TextureFaaLevel } from "@/config/texture";
import { summarizeTexture, unitRanges } from "@/lib/texture";
import type { TextureRunwayData } from "@/types/texture";
import { fmtInt, mmText } from "./texture-ui";

const LABEL = "text-[9px] tracking-[.07em] uppercase text-muted-foreground";
const VALUE = "font-mono text-lg font-bold text-foreground tabular-nums leading-tight";
const NOTE = "text-[10px] text-muted-foreground tabular-nums";
/** Above this many, the no-keel units are written as ranges so the note stays short. */
const LIST_UNITS_UP_TO = 6;

const WORST_NOTE: Record<TextureFaaLevel, string> = {
  ok: "",
  measure: "measure texture at every friction survey",
  plan: "plan correction within a year",
  gap: "between the AC's levels; no action stated",
  correct: "correct within 2 months",
};

interface TextureSummaryProps {
  data: TextureRunwayData;
  onSelectUnit: (unit: number) => void;
}

// One strip of figures for the active runway, in the StatsBar style.
export default function TextureSummary({ data, onSelectUnit }: TextureSummaryProps) {
  const s = useMemo(() => summarizeTexture(data), [data]);
  const { n_units_total, n_units_with_keel, no_keel } = data.coverage;
  const lowest = s.lowest;
  const noKeelText = no_keel.length <= LIST_UNITS_UP_TO ? no_keel.join(", ") : unitRanges(no_keel).join(", ");

  return (
    <div className="px-4 py-3 bg-card border-t border-border">
      <div className="flex flex-wrap items-stretch gap-y-3 [&>*]:pr-5 [&>*]:mr-5 [&>*:not(:last-child)]:border-r [&>*]:border-border">
        <div className="flex flex-col gap-1">
          <span className={LABEL}>Keel ETD</span>
          <span className={VALUE}>
            {mmText(data.runway_keel.etd_mm)} <span className="text-xs font-normal text-muted-foreground">mm</span>
          </span>
          <span className={NOTE}>
            ±{data.keel.half_width_m} m, {fmtInt(data.runway_keel.n)} values
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className={LABEL}>FAA zones</span>
          <span className={VALUE}>
            {s.zonesBelowMeasure} <span className="text-xs font-normal text-muted-foreground">of {data.zones.length} below 1.14 mm</span>
          </span>
          {WORST_NOTE[s.worstLevel] && <span className={NOTE}>{WORST_NOTE[s.worstLevel]}</span>}
        </div>

        <div className="flex flex-col gap-1">
          <span className={LABEL}>Lowest unit</span>
          {lowest ? (
            <button
              onClick={() => onSelectUnit(lowest.unit)}
              className="text-left rounded-sm -m-1 p-1 hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              title="Select this unit"
            >
              <span className={`block ${VALUE}`}>
                {mmText(lowest.keel.etd_mm)} <span className="text-xs font-normal text-muted-foreground">mm</span>
              </span>
              <span className={NOTE}>unit {lowest.unit}</span>
            </button>
          ) : (
            <span className={VALUE}>—</span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className={LABEL}>Units below 0.76 mm</span>
          <span className={VALUE}>
            {s.belowPlanning.length} <span className="text-xs font-normal text-muted-foreground">of {s.nWithKeel}</span>
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className={LABEL}>Coverage</span>
          <span className={VALUE}>
            {n_units_with_keel} / {n_units_total} <span className="text-xs font-normal text-muted-foreground">units</span>
          </span>
          {no_keel.length > 0 && (
            <span className={NOTE}>
              no keel values: unit{no_keel.length > 1 ? "s" : ""} {noKeelText}
            </span>
          )}
        </div>

        {data.qc.n_high > 0 && (
          <div className="flex flex-col gap-1">
            <span className={LABEL}>Values above 2 mm</span>
            <span className={VALUE}>{data.qc.n_high}</span>
            <span className={NOTE}>{data.qc.n_high_keel} in the keel · check LCMS images</span>
          </div>
        )}
      </div>
    </div>
  );
}
