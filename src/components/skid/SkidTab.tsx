import { useCallback, useMemo, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DEFAULT_SKID_BASIS } from "@/config/skid";
import { useNarrowViewport } from "@/hooks/useNarrowViewport";
import { useSkidData } from "@/hooks/useSkidData";
import { useSkidTrace } from "@/hooks/useSkidTrace";
import { governingFor, summarize } from "@/lib/skid";
import type { LaneCode, RunwayId, SkidBasis, SkidRunwayData } from "@/types/skid";
import SkidMap from "./SkidMap";
import SkidLegend from "./SkidLegend";
import SkidSummary from "./SkidSummary";
import SkidHeatmap from "./SkidHeatmap";
import SkidProfile from "./SkidProfile";
import SkidRuns from "./SkidRuns";
import SkidAbout from "./SkidAbout";
import SkidUnitPanel from "./SkidUnitPanel";
import {
  BASIS_LABEL,
  DEFAULT_OVERLAYS,
  RUNWAYS,
  RUNWAY_BY_ID,
  mirrorLane,
  type HeatRes,
  type MapLanes,
  type Overlays,
  type ProfileView,
  type SelectedUnit,
  type XDomain,
} from "./skid-ui";

export default function SkidTab() {
  const { data: bundles, error, loading } = useSkidData();
  const narrow = useNarrowViewport();
  const [runway, setRunway] = useState<RunwayId>("06-24");
  const [basis, setBasis] = useState<SkidBasis>(DEFAULT_SKID_BASIS);
  const [mapLanes, setMapLanes] = useState<MapLanes>("off");
  const [heatmapRes, setHeatmapRes] = useState<HeatRes>("unit");
  const [selected, setSelected] = useState<SelectedUnit | null>(null);
  const [profileView, setProfileView] = useState<ProfileView>("one");
  // null = the runway's default lane (the governing lane of its lowest unit).
  const [profileLanes, setProfileLanes] = useState<LaneCode[] | null>(null);
  const [xDomain, setXDomain] = useState<XDomain>(null);
  const [overlays, setOverlays] = useState<Overlays>(DEFAULT_OVERLAYS);

  // Per-meter readings of the active runway: the profile is always on the page, so this loads on entry.
  const traceState = useSkidTrace(runway);

  const perUnit = useMemo(
    () => bundles && (Object.fromEntries(RUNWAYS.map((r) => [r.id, bundles[r.id].data])) as Record<RunwayId, SkidRunwayData>),
    [bundles],
  );

  // Lane and zoom belong to one runway, so switching runway resets them.
  const changeRunway = (rw: RunwayId) => {
    setRunway(rw);
    setProfileLanes(null);
    setXDomain(null);
  };

  // Clicking a unit anywhere also switches the active runway. In One lane view
  // the profile follows to that unit's governing lane; the other views keep their lanes.
  const handleSelect = useCallback(
    (rw: RunwayId, unit: number) => {
      setSelected({ runway: rw, unit });
      const u = perUnit?.[rw].units[unit - 1];
      const gov = u ? governingFor(u, basis) : null;
      const follow = profileView === "one" && gov ? [gov.lane] : null;
      if (rw !== runway) {
        setRunway(rw);
        setXDomain(null);
        setProfileLanes(follow);
      } else if (follow) {
        setProfileLanes(follow);
      }
    },
    [perUnit, basis, runway, profileView],
  );
  const clearSelection = useCallback(() => setSelected(null), []);

  // "Show in profile" in the unit panel: One lane view on that unit, then scroll to it.
  const showInProfile = useCallback((lane: LaneCode, domain: [number, number]) => {
    setProfileView("one");
    setProfileLanes([lane]);
    setXDomain(domain);
    document.getElementById("skid-profile")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  if (loading || !bundles || !perUnit) {
    return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading skid resistance data...</div>;
  }

  const data = perUnit[runway];
  const defaultLane = summarize(data, "152m").lowest?.lane ?? "L3.0";
  const lane0 = profileLanes?.[0] ?? defaultLane;

  // Compare needs at least two lanes to be useful (start with the mirror lane); One lane keeps just the first.
  const changeView = (v: ProfileView) => {
    setProfileView(v);
    if (v === "compare" && (profileLanes?.length ?? 1) < 2) setProfileLanes([lane0, mirrorLane(lane0)]);
    if (v === "one") setProfileLanes([lane0]);
  };

  const selectedHere = selected?.runway === runway ? selected.unit : null;
  const panel = (
    <SkidUnitPanel data={perUnit} selected={selected} basis={basis} onClose={clearSelection} onShowInProfile={showInProfile} />
  );

  const toolbar = (
    <div className={`${narrow ? "" : "sticky top-0 z-20"} flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 bg-card border-b border-border`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={runway} onValueChange={(v) => v && changeRunway(v as RunwayId)}>
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
            <ToggleGroupItem value="meter">Per meter</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">Survey: June 2026 · 65 km/h</p>
    </div>
  );

  // The page reads map → summary → heatmap → profile, then (reference material) the run list and About.
  // On desktop the unit panel is docked on the right; on narrow screens it sits between the profile and the tail.
  const tail = (
    <>
      <SkidRuns data={perUnit} />
      <SkidAbout data={perUnit} />
    </>
  );
  const main = (
    <>
      {toolbar}
      <div className="relative shrink-0 h-[46vh] min-h-[300px]">
        <SkidMap
          bundles={bundles}
          runway={runway}
          basis={basis}
          selected={selected}
          mapLanes={mapLanes}
          trace={traceState.trace ?? null}
          onSelect={handleSelect}
        />
      </div>
      <SkidLegend basis={basis} res={mapLanes === "meter" ? "meter" : "unit"} />
      <SkidSummary data={data} basis={basis} onSelectUnit={(unit) => handleSelect(runway, unit)} />
      <SkidHeatmap
        data={data}
        runway={RUNWAY_BY_ID[runway]}
        basis={basis}
        res={heatmapRes}
        onRes={setHeatmapRes}
        traceState={traceState}
        xDomain={xDomain}
        selectedUnit={selectedHere}
        onSelectUnit={(unit) => handleSelect(runway, unit)}
      />
      <SkidProfile
        runway={RUNWAY_BY_ID[runway]}
        selectedUnit={selectedHere}
        view={profileView}
        onView={changeView}
        lanes={profileLanes ?? [defaultLane]}
        onLanes={setProfileLanes}
        xDomain={xDomain}
        onXDomain={setXDomain}
        overlays={overlays}
        onOverlays={setOverlays}
        narrow={narrow}
        onSelectUnit={(unit) => handleSelect(runway, unit)}
        traceState={traceState}
      />
    </>
  );

  if (narrow) {
    return (
      <div className="h-full overflow-y-auto custom-scrollbar">
        {main}
        <div className="bg-card border-t border-border">{panel}</div>
        {tail}
      </div>
    );
  }

  return (
    <div className="h-full flex">
      <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar">
        {main}
        {tail}
      </div>
      <aside className="shrink-0 w-[400px] overflow-y-auto custom-scrollbar bg-card border-l border-border">{panel}</aside>
    </div>
  );
}
