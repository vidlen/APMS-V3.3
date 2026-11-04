import { useMemo } from "react";
import { TEXTURE_CLASSES, TEXTURE_CLASS_META } from "@/config/texture";
import { hasHighKeel, summarizeTexture } from "@/lib/texture";
import type { TextureRunwayData } from "@/types/texture";

// Colour key of the map, with the number of units in each class.
export default function TextureLegend({ data }: { data: TextureRunwayData }) {
  const { classCounts } = useMemo(() => summarizeTexture(data), [data]);
  const hatched = useMemo(() => data.units.some(hasHighKeel), [data]);
  return (
    <div className="px-4 py-2.5 bg-card border-t border-border">
      <h3 className="panel-label mb-1.5">Keel ETD per sample unit</h3>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {TEXTURE_CLASSES.map((c) => (
          <li key={c} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-3.5 h-3.5 rounded-sm shrink-0 border border-border" style={{ backgroundColor: TEXTURE_CLASS_META[c].color }} />
            {TEXTURE_CLASS_META[c].label}
            <span className="font-mono font-medium text-foreground tabular-nums">{classCounts[c]}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground mt-1.5">
        Only 1.14, 0.76 and 0.25 mm are FAA levels (AC 150/5320-12C par. 3-23b), and FAA applies them to zone averages; bands between 0.76 and 1.14 mm are display bands.
        {hatched && " Hatched units hold keel values above 2 mm."}
      </p>
    </div>
  );
}
