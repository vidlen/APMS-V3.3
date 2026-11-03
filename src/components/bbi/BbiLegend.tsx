import { useMemo } from "react";
import { BBI_CLASSES, BBI_CLASS_META } from "@/config/bbi";
import { summarizeBbi } from "@/lib/bbi";
import type { BbiRunwayData } from "@/types/bbi";

// Colour key of the map, with the number of units in each class.
export default function BbiLegend({ data }: { data: BbiRunwayData }) {
  const { classCounts } = useMemo(() => summarizeBbi(data), [data]);
  return (
    <div className="px-4 py-2.5 bg-card border-t border-border">
      <h3 className="panel-label mb-1.5">Boeing Bump Index · highest value in the unit</h3>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {BBI_CLASSES.map((c) => (
          <li key={c} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-3.5 h-3.5 rounded-sm shrink-0 border border-border" style={{ backgroundColor: BBI_CLASS_META[c].color }} />
            {BBI_CLASS_META[c].label}
            <span className="font-mono font-medium text-foreground tabular-nums">{classCounts[c]}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground mt-1.5">
        Only the 1.0 limit is an FAA criterion (AC 150/5380-9); the bands below 1.0 are display bands. Hatched units: the governing value lies in the first 120 m of a run.
      </p>
    </div>
  );
}
