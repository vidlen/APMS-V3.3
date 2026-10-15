import { useCallback, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DEFAULT_SKID_BASIS, classifySkid, SKID_CLASS_META } from "@/config/skid";
import { governingFor } from "@/lib/skid";
import { useSkidData } from "@/hooks/useSkidData";
import type { RunwayId, SkidBasis } from "@/types/skid";
import SkidMap from "./SkidMap";
import SkidLegend from "./SkidLegend";
import { BASIS_LABEL, RUNWAYS, RUNWAY_BY_ID, muText, type MapLanes, type SelectedUnit } from "./skid-ui";

export default function SkidTab() {
  const { data: bundles, error, loading } = useSkidData();
  const [runway, setRunway] = useState<RunwayId>("06-24");
  const [basis, setBasis] = useState<SkidBasis>(DEFAULT_SKID_BASIS);
  const [mapLanes, setMapLanes] = useState<MapLanes>("off");
  const [selected, setSelected] = useState<SelectedUnit | null>(null);

  // Clicking a unit on either runway also switches the active runway.
  const handleSelect = useCallback((rw: RunwayId, unit: number) => {
    setRunway(rw);
    setSelected({ runway: rw, unit });
  }, []);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <div className="text-center space-y-2 max-w-md">
          <p className="text-foreground font-medium">Failed to load skid resistance data</p>
          <p className="text-muted-foreground text-sm break-words">{error}</p>
        </div>
      </div>
    );
  }
  if (loading || !bundles) {
    return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading skid resistance data...</div>;
  }

  const selUnit = selected ? bundles[selected.runway].data.units[selected.unit - 1] : null;
  const selGov = selUnit ? governingFor(selUnit, basis) : null;

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 bg-card border-b border-border">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ToggleGroup type="single" variant="outline" size="sm" value={runway} onValueChange={(v) => v && setRunway(v as RunwayId)}>
            {RUNWAYS.map((r) => (
              <ToggleGroupItem key={r.id} value={r.id}>
                {r.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <div className="flex items-center gap-2">
            <span className="panel-label">Basis</span>
            <ToggleGroup type="single" variant="outline" size="sm" value={basis} onValueChange={(v) => v && setBasis(v as SkidBasis)}>
              {(Object.keys(BASIS_LABEL) as SkidBasis[]).map((b) => (
                <ToggleGroupItem key={b} value={b}>
                  {BASIS_LABEL[b]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="flex items-center gap-2">
            <span className="panel-label">Map lanes</span>
            <ToggleGroup type="single" variant="outline" size="sm" value={mapLanes} onValueChange={(v) => v && setMapLanes(v as MapLanes)}>
              <ToggleGroupItem value="off">Off</ToggleGroupItem>
              <ToggleGroupItem value="unit">Per unit</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">Survey: June 2026 · 65 km/h</p>
      </div>

      <div className="relative flex-1 min-h-[300px]">
        <SkidMap bundles={bundles} runway={runway} basis={basis} selected={selected} mapLanes={mapLanes} onSelect={handleSelect} />
      </div>

      <SkidLegend basis={basis} />

      {/* Placeholder readout until the unit detail panel lands (stage 3). */}
      <div className="shrink-0 px-4 py-2 bg-card border-t border-border text-xs text-muted-foreground">
        {selected && selUnit ? (
          selGov ? (
            <>
              {RUNWAY_BY_ID[selected.runway].label} · Unit <span className="font-mono text-foreground">{selected.unit}</span> — μ{" "}
              <span className="font-mono text-foreground">{muText(selGov.mu)}</span> ({selGov.lane}) ·{" "}
              {SKID_CLASS_META[classifySkid(selGov.mu)].label}
            </>
          ) : (
            <>
              {RUNWAY_BY_ID[selected.runway].label} · Unit <span className="font-mono text-foreground">{selected.unit}</span> — not measured
            </>
          )
        ) : (
          "Select a sample unit on the map."
        )}
      </div>
    </div>
  );
}
