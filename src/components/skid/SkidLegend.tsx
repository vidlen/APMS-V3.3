import { SKID_CLASS_META, type SkidClass } from "@/config/skid";
import type { SkidBasis } from "@/types/skid";
import Mu from "./Mu";

const CLASSES: SkidClass[] = ["belowMinimum", "belowMaintenance", "aboveMaintenance", "newDesign", "noData"];

const REF_NOTE = "FAA thresholds shown for reference; FAA assesses 152 m averages";

function title(basis: SkidBasis, res: "unit" | "meter"): string {
  if (res === "meter") return `Friction coefficient μ · 1 m readings — ${REF_NOTE}`;
  return basis === "152m"
    ? "Friction coefficient μ · 152 m average (FAA basis)"
    : `Friction coefficient μ · 10 m unit average — ${REF_NOTE}`;
}

// Colour key for the active view; the title always names the basis in use.
export default function SkidLegend({ basis, res = "unit" }: { basis: SkidBasis; res?: "unit" | "meter" }) {
  return (
    <div className="px-4 py-2.5 bg-card border-t border-border">
      <h3 className="panel-label mb-1.5">
        {title(basis, res).split("μ").flatMap((part, i) => (i === 0 ? [part] : [<Mu key={i} />, part]))}
      </h3>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {CLASSES.map((c) => (
          <li key={c} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className="w-3.5 h-3.5 rounded-sm shrink-0 border border-border"
              style={{ backgroundColor: SKID_CLASS_META[c].color }}
            />
            {SKID_CLASS_META[c].label}
          </li>
        ))}
      </ul>
    </div>
  );
}
