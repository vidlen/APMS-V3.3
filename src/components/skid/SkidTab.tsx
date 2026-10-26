import { useCallback, useEffect, useMemo, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DEFAULT_SKID_BASIS } from "@/config/skid";
import { useNarrowViewport } from "@/hooks/useNarrowViewport";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSkidData } from "@/hooks/useSkidData";
import { useSkidSurveys } from "@/hooks/useSkidSurveys";
import { useSkidTrace } from "@/hooks/useSkidTrace";
import { governingFor, summarize } from "@/lib/skid";
import { parseSkidUrl, skidUrlSearch } from "@/lib/skid-url";
import type { LaneCode, RunwayId, SkidRunwayData } from "@/types/skid";
import SkidMap from "./SkidMap";
import SkidLegend from "./SkidLegend";
import SkidSummary from "./SkidSummary";
import SkidHeatmap from "./SkidHeatmap";
import SkidProfile from "./SkidProfile";
import SkidRuns from "./SkidRuns";
import SkidAbout from "./SkidAbout";
import SkidUnitPanel from "./SkidUnitPanel";
import {
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
  const surveys = useSkidSurveys(); // newest first; the June 2026 seed is always there
  const narrow = useNarrowViewport();
  // A shared link (?rw=07L-25R&unit=301&lane=L3.0 ...) sets the first view; read once, validated in skid-url.ts.
  const [initial] = useState(() => parseSkidUrl(window.location.search));
  const [surveyId, setSurveyId] = useState<string | undefined>(initial.survey);
  // An unknown or deleted id falls back to the newest survey.
  const survey = surveys.find((s) => s.id === surveyId) ?? surveys[0];
  const { data: bundles, error, loading } = useSkidData(survey);
  const [runway, setRunway] = useState<RunwayId>(initial.runway ?? "06-24");
  const basis = DEFAULT_SKID_BASIS; // 10 m only; the 152 m (FAA) toggle was dropped
  const [mapLanes, setMapLanes] = useState<MapLanes>("off");
  const [heatmapRes, setHeatmapRes] = useState<HeatRes>("unit");
  const [selected, setSelected] = useState<SelectedUnit | null>(
    initial.unit ? { runway: initial.runway ?? "06-24", unit: initial.unit } : null,
  );
  const [profileView, setProfileView] = useState<ProfileView>(initial.view ?? "one");
  // null = the runway's default lane (the governing lane of its lowest unit).
  const [profileLanes, setProfileLanes] = useState<LaneCode[] | null>(
    initial.view === "compare" && initial.lanes ? initial.lanes : initial.lane ? [initial.lane] : null,
  );
  const [xDomain, setXDomain] = useState<XDomain>(initial.x ?? null);
  const [overlays, setOverlays] = useState<Overlays>(DEFAULT_OVERLAYS);

  // Keep the address bar in step with the view so it can be copied and shared (replaceState: no history
  // entries; history.state is passed through so the router's own state survives).
  useEffect(() => {
    const q = skidUrlSearch(window.location.search, {
      survey: survey.id === surveys[0].id ? undefined : survey.id,
      runway,
      unit: selected?.runway === runway ? selected.unit : undefined,
      lane: profileLanes?.[0],
      lanes: profileLanes ?? undefined,
      basis,
      view: profileView,
      x: xDomain,
    });
    window.history.replaceState(window.history.state, "", q ? `?${q}` : window.location.pathname);
  }, [survey.id, surveys, runway, selected, profileLanes, basis, profileView, xDomain]);

  // Per-meter readings of the active runway: the profile is always on the page, so this loads on entry.
  const traceState = useSkidTrace(survey, survey.runways[runway] ? runway : null);

  const perUnit = useMemo(
    () => bundles && (Object.fromEntries(RUNWAYS.filter((r) => bundles[r.id]).map((r) => [r.id, bundles[r.id]?.data])) as Partial<Record<RunwayId, SkidRunwayData>>),
    [bundles],
  );

  // A different survey has its own units and lanes, so selection, lane and zoom start over.
  const changeSurvey = (id: string) => {
    setSurveyId(id);
    setSelected(null);
    setProfileLanes(null);
    setXDomain(null);
  };

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
      const u = perUnit?.[rw]?.units[unit - 1];
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
  const defaultLane = (data && (summarize(data, "152m").lowest?.lane ?? data.lanes.find((l) => l.measured !== false)?.code)) || "L3.0";
  const lane0 = profileLanes?.[0] ?? defaultLane;

  // Compare needs at least two lanes to be useful (start with the mirror lane); One lane keeps just the first.
  const changeView = (v: ProfileView) => {
    setProfileView(v);
    if (v === "compare" && (profileLanes?.length ?? 1) < 2) setProfileLanes([lane0, mirrorLane(lane0)]);
    if (v === "one") setProfileLanes([lane0]);
  };

  const selectedHere = selected?.runway === runway ? selected.unit : null;
  const panel = (
    <SkidUnitPanel survey={survey} data={perUnit} selected={selected} basis={basis} onClose={clearSelection} onShowInProfile={showInProfile} />
  );

  const toolbar = (
    <div className={`${narrow ? "" : "sticky top-0 z-20"} flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 bg-card border-b border-border`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {surveys.length > 1 ? (
          <div className="flex items-center gap-2">
            <span className="panel-label">Survey</span>
            <Select value={survey.id} onValueChange={changeSurvey}>
              <SelectTrigger size="sm" className="w-[130px]" aria-label="Survey">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {surveys.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <span className="text-sm text-foreground">{survey.label}</span>
        )}

        <ToggleGroup type="single" variant="outline" size="sm" value={runway} onValueChange={(v) => v && changeRunway(v as RunwayId)}>
          {RUNWAYS.map((r) => (
            <ToggleGroupItem key={r.id} value={r.id}>
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="flex items-center gap-2">
          <span className="panel-label">Map lanes</span>
          <ToggleGroup type="single" variant="outline" size="sm" value={mapLanes} onValueChange={(v) => v && setMapLanes(v as MapLanes)}>
            <ToggleGroupItem value="off">Off</ToggleGroupItem>
            <ToggleGroupItem value="unit">Per unit</ToggleGroupItem>
            <ToggleGroupItem value="meter">Per meter</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    </div>
  );

  // The page reads map → summary → heatmap → profile, then (reference material) the run list and About.
  // On desktop the unit panel is docked on the right; on narrow screens it sits between the profile and the tail.
  const tail = (
    <>
      <SkidRuns survey={survey} data={perUnit} />
      <SkidAbout survey={survey} data={perUnit} />
    </>
  );
  const missing = !data ? (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyTitle>{RUNWAY_BY_ID[runway].label} was not measured in this survey</EmptyTitle>
        <EmptyDescription>Choose another runway or another survey.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  ) : null;
  const main = missing ? (
    <>
      {toolbar}
      {missing}
    </>
  ) : (
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
      <SkidSummary data={data as SkidRunwayData} basis={basis} onSelectUnit={(unit) => handleSelect(runway, unit)} />
      <SkidHeatmap
        data={data as SkidRunwayData}
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
