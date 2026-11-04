import { useCallback, useEffect, useState } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useBbiData } from "@/hooks/useBbiData";
import { useBbiSurveys } from "@/hooks/useBbiSurveys";
import { useBbiTrace } from "@/hooks/useBbiTrace";
import { useNarrowViewport } from "@/hooks/useNarrowViewport";
import { bbiUrlSearch, parseBbiUrl, type BbiProfileView } from "@/lib/bbi-url";
import type { RunwayId } from "@/types/skid";
import BbiAbout from "./BbiAbout";
import BbiLegend from "./BbiLegend";
import BbiMap from "./BbiMap";
import BbiProfile from "./BbiProfile";
import BbiSummary from "./BbiSummary";
import BbiUnitPanel from "./BbiUnitPanel";
import { BBI_RUNWAYS, NO_07L_HINT, mirrorLine, type XDomain } from "./bbi-ui";

export default function BbiTab() {
  const surveys = useBbiSurveys(); // newest first; the June 2026 seed is always there
  const narrow = useNarrowViewport();
  // A shared link (?rw=06-24&unit=199&line=P02_L ...) sets the first view; read once, validated in bbi-url.ts.
  const [initial] = useState(() => parseBbiUrl(window.location.search));
  const [surveyId, setSurveyId] = useState<string | undefined>(initial.survey);
  // An unknown or deleted id falls back to the newest survey.
  const survey = surveys.find((s) => s.id === surveyId) ?? surveys[0];
  const [runwayChoice, setRunway] = useState<RunwayId>(initial.runway ?? "06-24");
  // A survey may hold only one runway: show what it has rather than an empty page.
  const runway = survey.runways[runwayChoice] ? runwayChoice : (BBI_RUNWAYS.find((r) => survey.runways[r.id])?.id ?? runwayChoice);
  const runwayMeta = BBI_RUNWAYS.find((r) => r.id === runway) ?? BBI_RUNWAYS[0];
  const [selectedUnit, setSelectedUnit] = useState<number | null>(initial.unit ?? null);
  const [view, setView] = useState<BbiProfileView>(initial.view ?? "one");
  // null = the default line (the one holding the runway's maximum BBI).
  const [lines, setLines] = useState<string[] | null>(initial.view === "compare" && initial.lines ? initial.lines : initial.line ? [initial.line] : null);
  const [xDomain, setXDomain] = useState<XDomain>(initial.x ?? null);

  const { data: bundle, error, loading } = useBbiData(survey, runway);
  // The profile is always on the page, so the 0.25 m points load right after the per-unit file.
  const traceState = useBbiTrace(bundle ? (survey.runways[runway]?.traceUrl ?? null) : null);

  const data = bundle?.data;
  const knownLines = lines?.filter((c) => data?.lines.some((l) => l.code === c));
  const defaultLine = data ? (data.lines.find((l) => l.bbi_max === Math.max(...data.lines.map((m) => m.bbi_max)))?.code ?? data.lines[0].code) : "";
  const shownLines = knownLines && knownLines.length > 0 ? knownLines : [defaultLine];

  // Keep the address bar in step with the view so it can be copied and shared (replaceState: no history
  // entries; history.state is passed through so the router's own state survives).
  useEffect(() => {
    const q = bbiUrlSearch(window.location.search, {
      survey: survey.id === surveys[0].id ? undefined : survey.id,
      runway,
      unit: selectedUnit ?? undefined,
      line: lines?.[0],
      lines: lines ?? undefined,
      view,
      x: xDomain,
    });
    window.history.replaceState(window.history.state, "", q ? `?${q}` : window.location.pathname);
  }, [survey.id, surveys, runway, selectedUnit, lines, view, xDomain]);

  // A different survey or runway has its own units and lines, so selection, line and zoom start over.
  const resetView = () => {
    setSelectedUnit(null);
    setLines(null);
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

  // In One line view the profile follows to the selected unit's governing line.
  const handleSelect = useCallback(
    (unit: number) => {
      setSelectedUnit(unit);
      const g = data?.units[unit - 1]?.governing;
      if (view === "one" && g) setLines([g.line]);
    },
    [data, view],
  );
  const clearSelection = useCallback(() => setSelectedUnit(null), []);

  // "Show in profile" in the unit panel: One line view on that line, then jump to it. Not a smooth scroll: the
  // re-render and replaceState that follow this click cancel the animation before it moves (seen in Chromium).
  const showInProfile = useCallback((line: string, domain: [number, number]) => {
    setView("one");
    setLines([line]);
    setXDomain(domain);
    document.getElementById("bbi-profile")?.scrollIntoView({ block: "start" });
  }, []);

  // Compare needs at least two lines to be useful (start with the other side of the pass); One line keeps just the first.
  const changeView = (v: BbiProfileView) => {
    setView(v);
    if (v === "compare" && shownLines.length < 2) setLines([shownLines[0], mirrorLine(shownLines[0])]);
    if (v === "one") setLines([shownLines[0]]);
  };

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
        {BBI_RUNWAYS.map((r) => {
          const has = survey.runways[r.id] !== undefined;
          // A disabled button takes no pointer events, so the tooltip sits on a wrapper.
          return (
            <span key={r.id} title={has ? undefined : NO_07L_HINT} className="inline-flex">
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
          <p className="text-foreground font-medium">Failed to load roughness data</p>
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
            <EmptyTitle>{runwayMeta.label} has no BBI in this survey</EmptyTitle>
            <EmptyDescription>Choose another runway or another survey.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }
  if (loading || !bundle || !data) {
    return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading roughness data...</div>;
  }

  const unit = selectedUnit === null ? null : (data.units[selectedUnit - 1] ?? null);
  const panel = <BbiUnitPanel data={data} runway={runwayMeta} unit={unit} onClose={clearSelection} onShowInProfile={showInProfile} />;
  // The page reads summary → map → legend → profile, then the About section.
  const main = (
    <>
      {toolbar}
      <BbiSummary data={data} onSelectUnit={handleSelect} />
      <div className="relative shrink-0 h-[46vh] min-h-[300px]">
        <BbiMap bundle={bundle} selectedUnit={selectedUnit} onSelect={handleSelect} />
      </div>
      <BbiLegend data={data} />
      <BbiProfile
        data={data}
        runway={runwayMeta}
        selectedUnit={unit}
        view={view}
        onView={changeView}
        lines={shownLines}
        onLines={setLines}
        xDomain={xDomain}
        onXDomain={setXDomain}
        narrow={narrow}
        onSelectUnit={handleSelect}
        traceState={traceState}
      />
    </>
  );
  const tail = <BbiAbout data={data} />;

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
      <aside className="shrink-0 w-[500px] overflow-y-auto custom-scrollbar bg-card border-l border-border">{panel}</aside>
    </div>
  );
}
