import { useCallback, useEffect, useState } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useNarrowViewport } from "@/hooks/useNarrowViewport";
import { useTextureData } from "@/hooks/useTextureData";
import { useTextureSurveys } from "@/hooks/useTextureSurveys";
import type { TextureMode, TextureZoneChoice } from "@/lib/texture";
import { parseTextureUrl, textureUrlSearch } from "@/lib/texture-url";
import type { RunwayId } from "@/types/skid";
import TextureAbout from "./TextureAbout";
import TextureAlongChart from "./TextureAlongChart";
import TextureCrossSection from "./TextureCrossSection";
import TextureLegend from "./TextureLegend";
import TextureMap from "./TextureMap";
import TextureSummary from "./TextureSummary";
import TextureUnitPanel from "./TextureUnitPanel";
import TextureZoneTable from "./TextureZoneTable";
import { TEXTURE_RUNWAYS, type XDomain } from "./texture-ui";

export default function TextureTab() {
  const surveys = useTextureSurveys(); // newest first; the June 2026 seed is always there
  const narrow = useNarrowViewport();
  // A shared link (?rw=06-24&unit=14&zone=1 ...) sets the first view; read once, validated in texture-url.ts.
  const [initial] = useState(() => parseTextureUrl(window.location.search));
  const [surveyId, setSurveyId] = useState<string | undefined>(initial.survey);
  // An unknown or deleted id falls back to the newest survey.
  const survey = surveys.find((s) => s.id === surveyId) ?? surveys[0];
  const [runwayChoice, setRunway] = useState<RunwayId>(initial.runway ?? "06-24");
  // A survey may hold only one runway: show what it has rather than an empty page.
  const runway = survey.runways[runwayChoice] ? runwayChoice : (TEXTURE_RUNWAYS.find((r) => survey.runways[r.id])?.id ?? runwayChoice);
  const runwayMeta = TEXTURE_RUNWAYS.find((r) => r.id === runway) ?? TEXTURE_RUNWAYS[0];
  const [selectedUnit, setSelectedUnit] = useState<number | null>(initial.unit ?? null);
  const [zone, setZone] = useState<TextureZoneChoice>(initial.zone ?? "all");
  const [mode, setMode] = useState<TextureMode>(initial.mode ?? "etd");
  const [xDomain, setXDomain] = useState<XDomain>(initial.x ?? null);

  const { data: bundle, error, loading } = useTextureData(survey, runway);
  const data = bundle?.data;

  // Keep the address bar in step with the view so it can be copied and shared (replaceState: no history
  // entries; history.state is passed through so the router's own state survives).
  useEffect(() => {
    const q = textureUrlSearch(window.location.search, {
      survey: survey.id === surveys[0].id ? undefined : survey.id,
      runway,
      unit: selectedUnit ?? undefined,
      zone,
      mode,
      x: xDomain,
    });
    window.history.replaceState(window.history.state, "", q ? `?${q}` : window.location.pathname);
  }, [survey.id, surveys, runway, selectedUnit, zone, mode, xDomain]);

  // A different survey or runway has its own units and zones, so selection, zone and zoom start over.
  const resetView = () => {
    setSelectedUnit(null);
    setZone("all");
    setXDomain(null);
  };
  const changeSurvey = (id: string) => {
    setSurveyId(id);
    resetView();
  };
  const changeRunway = (rw: RunwayId) => {
    setRunway(rw);
    resetView();
  };
  const clearSelection = useCallback(() => setSelectedUnit(null), []);

  // "Show in chart" in the unit panel: zoom, then jump to the chart. Not a smooth scroll: the re-render and
  // replaceState that follow this click cancel the animation before it moves (seen in Chromium).
  const showInChart = useCallback((domain: [number, number]) => {
    setXDomain(domain);
    document.getElementById("texture-along")?.scrollIntoView({ block: "start" });
  }, []);

  const toolbar = (
    <div className={`${narrow ? "" : "sticky top-0 z-20"} flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 bg-card border-b border-border`}>
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
        {TEXTURE_RUNWAYS.map((r) => {
          const has = survey.runways[r.id] !== undefined;
          // A disabled button takes no pointer events, so the tooltip sits on a wrapper.
          return (
            <span key={r.id} title={has ? undefined : `${r.label} is not in this survey.`} className="inline-flex">
              <ToggleGroupItem value={r.id} disabled={!has} className="rounded-md border-l">
                {r.label}
              </ToggleGroupItem>
            </span>
          );
        })}
      </ToggleGroup>
    </div>
  );

  if (error) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <div className="text-center space-y-2 max-w-md">
          <p className="text-foreground font-medium">Failed to load texture data</p>
          <p className="text-muted-foreground text-sm break-words">{error}</p>
        </div>
      </div>
    );
  }
  if (!survey.runways[runway]) {
    return (
      <div className="h-full overflow-y-auto">
        {toolbar}
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyTitle>{runwayMeta.label} has no texture data in this survey</EmptyTitle>
            <EmptyDescription>Choose another runway or another survey.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }
  if (loading || !bundle || !data) {
    return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading texture data...</div>;
  }

  const unit = selectedUnit === null ? null : (data.units[selectedUnit - 1] ?? null);
  // Keyed by unit so the folded table of values above 2 mm starts folded for each unit.
  const panel = <TextureUnitPanel key={unit?.unit} data={data} runway={runwayMeta} unit={unit} onClose={clearSelection} onShowInChart={showInChart} />;
  // The page reads map → legend → summary → zones → along → across (map first, as in Skid), then the About section.
  const main = (
    <>
      {toolbar}
      <div className="relative shrink-0 h-[46vh] min-h-[300px]">
        <TextureMap bundle={bundle} selectedUnit={selectedUnit} zone={zone} onSelect={setSelectedUnit} />
      </div>
      <TextureLegend data={data} />
      <TextureSummary data={data} onSelectUnit={setSelectedUnit} />
      <div className="px-4 py-3 bg-card border-t border-border">
        <h3 className="panel-label mb-1.5">FAA verdict per zone</h3>
        <TextureZoneTable data={data} zone={zone} onZone={setZone} />
        <p className="text-[11px] text-muted-foreground mt-1.5">
          FAA judges the average texture depth of each runway zone (touchdown, midpoint, rollout). The runway is used in both directions, so the zones here are thirds by position.
        </p>
      </div>
      <TextureAlongChart data={data} runway={runwayMeta} selectedUnit={unit} zone={zone} mode={mode} onMode={setMode} xDomain={xDomain} onXDomain={setXDomain} narrow={narrow} onSelectUnit={setSelectedUnit} />
      <TextureCrossSection data={data} zone={zone} onZone={setZone} narrow={narrow} />
    </>
  );
  const tail = <TextureAbout data={data} />;

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
      <aside className="shrink-0 w-[420px] overflow-y-auto custom-scrollbar bg-card border-l border-border">{panel}</aside>
    </div>
  );
}
