import { useCallback, useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FAA_LINES, FAA_TRACKS, LANE_ORDER, LANE_STYLE, SKID_SPEED } from "@/config/skid";
import { useElementWidth } from "@/hooks/useElementWidth";
import type { SkidTraceState } from "@/hooks/useSkidTrace";
import { exportName, profileCsv } from "@/lib/skid-export";
import { evaluateFaa320, fixedSegments, laneKey, profileRows, thirds as thirdsOf, unitXRange } from "@/lib/skid-trace";
import type { LaneCode } from "@/types/skid";
import { downloadText, profileSvg, type LegendItem, type SvgPart } from "./skid-svg";
import SkidProfileChart from "./SkidProfileChart";
import SkidSpeedStrip from "./SkidSpeedStrip";
import SkidSegmentTable from "./SkidSegmentTable";
import SkidSegmentMatrix from "./SkidSegmentMatrix";
import SkidPrint from "./SkidPrint";
import {
  OVERLAY_LABELS,
  PROFILE_MARGIN,
  Y_AXIS_WIDTH,
  laneHeaderLines,
  muText,
  profileMargin,
  surveyDate,
  type Overlays,
  type ProfileView,
  type RunwayMeta,
  type XDomain,
} from "./skid-ui";

const SYNC_ONE = "skid-profile-one";
const SYNC_ALL = "skid-profile-all";
const MAX_ROWS = 1500;
const LABEL_W = 72; // lane label column of the small multiples
const MINI_PLOT = 104; // plot height of each small multiple in All lanes (0.1 of μ = 10 px, room for the top chart's FAA labels)

const TRACK_HINT = "FAA surveys 3 m and 6 m right of the centre line in the landing direction (AC 150/5320-12C par. 3-15.b).";

const btn =
  "h-8 px-3 rounded-md text-xs font-medium border border-border text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:pointer-events-none";

interface SkidProfileProps {
  runway: RunwayMeta;
  /** Selected unit on this runway, or null. */
  selectedUnit: number | null;
  view: ProfileView;
  onView: (view: ProfileView) => void;
  /** Lanes of One lane (first) and Compare. All lanes always draws all eight. */
  lanes: LaneCode[];
  onLanes: (lanes: LaneCode[]) => void;
  xDomain: XDomain;
  onXDomain: (domain: XDomain) => void;
  overlays: Overlays;
  onOverlays: (overlays: Overlays) => void;
  narrow: boolean;
  onSelectUnit: (unit: number) => void;
  traceState: SkidTraceState;
}

// "Vehicle view": the friction trace as on the test vehicle's screen and
// printout (FAA AC 150/5320-12C App. 3 par. 1.a(9)), for one lane, a few
// lanes overlaid, or all eight stacked.
export default function SkidProfile({
  runway,
  selectedUnit,
  view: viewProp,
  onView,
  lanes,
  onLanes,
  xDomain,
  onXDomain,
  overlays,
  onOverlays,
  narrow,
  onSelectUnit,
  traceState,
}: SkidProfileProps) {
  const { trace: rt, ma, loading, error } = traceState;
  const [plotRef, plotWidth] = useElementWidth<HTMLDivElement>();
  const [printing, setPrinting] = useState(false);
  const stopPrinting = useCallback(() => setPrinting(false), []);

  // Phones get One lane only.
  const view: ProfileView = narrow ? "one" : viewProp;
  const shownCodes: LaneCode[] =
    view === "all" ? LANE_ORDER : view === "one" ? [lanes[0]] : LANE_ORDER.filter((c) => lanes.includes(c));
  const shown = rt ? shownCodes.flatMap((c) => rt.lanes.filter((l) => l.lane === c)) : [];
  const lane = shown[0] ?? null;

  const last = rt?.unit_bounds.last_end_m ?? 0;
  const domain: [number, number] = xDomain ?? [0, last];

  const rows = useMemo(
    () =>
      rt && shown.length > 0 && ma && plotWidth > 0
        ? profileRows(rt, shown, domain, Math.min(MAX_ROWS, plotWidth - profileMargin(plotWidth).right - Y_AXIS_WIDTH), ma)
        : [],
    // `shown` and `domain` are rebuilt each render; their keys are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rt, ma, plotWidth, shownCodes.join(), domain[0], domain[1]],
  );
  const segments = useMemo(() => (view === "one" && lane ? fixedSegments(lane) : []), [view, lane]);
  const thirds = useMemo(() => (view === "one" && lane ? thirdsOf(lane) : []), [view, lane]);
  const faa = useMemo(() => evaluateFaa320(segments), [segments]);

  const clamp = (d: [number, number]): XDomain => [Math.max(0, d[0]), Math.min(last, d[1])];
  const unitZoom = () => {
    if (rt && selectedUnit !== null) {
      const [a, b] = unitXRange(rt, selectedUnit);
      onXDomain(clamp([a - 150, b + 150]));
    }
  };

  const clickLane = (code: LaneCode) => {
    if (view === "compare") {
      const next = lanes.includes(code) ? lanes.filter((l) => l !== code) : [...lanes, code];
      if (next.length > 0) onLanes(next);
    } else {
      // From One lane this just switches lane; from All lanes it also drops back to One lane.
      if (view === "all") onView("one");
      onLanes([code]);
    }
  };
  const faaTrack = (codes: LaneCode[]) => {
    onView("compare");
    onLanes(codes);
  };

  // The two header lines double as the title of the exported SVG.
  const wetting = rt ? (rt.survey.wetting === "On" ? "self-wetting (1 mm)" : `wetting ${rt.survey.wetting}`) : "";
  const headerLines: string[] =
    rt && lane
      ? view === "one"
        ? laneHeaderLines(rt, runway, lane)
        : [
            `${runway.label} · ${view === "all" ? "All lanes" : `Compare ${shown.map((l) => l.lane).join(", ")}`} · Test direction ${rt.survey.direction} · ${surveyDate(rt.survey)} (WIB)`,
            `${rt.survey.speed_kmh} km/h · ${wetting} · ${overlays.avg ? "lines are the 152 m moving average of each lane" : "raw 1 m readings"}`,
          ]
      : [];

  // Export: CSV of the visible readings, SVG of the plots with title and legend (for figures).
  const lanesLabel = view === "all" ? "all-lanes" : shownCodes.join("_");
  const exportCsv = () => {
    if (rt && ma) downloadText(exportName(rt.runway, lanesLabel, domain, "csv"), profileCsv(rt, shownCodes, domain, ma), "text/csv;charset=utf-8");
  };
  const exportSvg = () => {
    const card = plotRef.current;
    if (!rt || !card) return;
    const legend: LegendItem[] = [
      ...(overlays.raw ? [{ label: "Raw 1 m readings (min–max)", color: "#8A8A8A" }] : []),
      ...(overlays.avg
        ? view === "compare"
          ? shown.map((l) => ({ label: `${l.lane} 152 m avg`, color: LANE_STYLE[l.lane].color, dash: LANE_STYLE[l.lane].dash }))
          : [{ label: "152 m moving average", color: "#26215C" }]
        : []),
      ...(view === "one" && overlays.segments ? [{ label: "152 m segments", color: "#D97706" }] : []),
      ...(view === "one" && overlays.thirds ? [{ label: "Thirds", color: "#0F766E", dash: "7 4" }] : []),
      ...FAA_LINES.map((l) => ({ label: l.label, color: l.color, dash: l.dash })),
    ];
    // One lane: friction plot then speed strip; Compare: one plot; All lanes: eight plots, labelled in a side column.
    const parts: SvgPart[] = [...card.querySelectorAll<SVGSVGElement>("svg.recharts-surface")].map((svg, i) =>
      view === "all" ? { svg, x: LABEL_W, label: [shown[i].lane, `μ̄ ${muText(shown[i].stats.mean_mu)}`] } : { svg },
    );
    downloadText(exportName(rt.runway, lanesLabel, domain, "svg"), profileSvg(parts, headerLines, legend), "image/svg+xml;charset=utf-8");
  };

  const overlayKeys = Object.keys(OVERLAY_LABELS) as (keyof Overlays)[];
  const chartHeight = narrow ? 280 : 340;
  const chipValue = view === "compare" ? lanes : view === "one" ? [lanes[0]] : [];

  const compareLegend = (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 text-[11px]">
      {shown.map((l) => (
        <span key={l.lane} className="inline-flex items-center gap-1.5">
          <svg width="22" height="8" aria-hidden>
            <line x1="0" y1="4" x2="22" y2="4" stroke={LANE_STYLE[l.lane].color} strokeWidth="2.5" strokeDasharray={LANE_STYLE[l.lane].dash || undefined} />
          </svg>
          {l.lane}
        </span>
      ))}
      <span className="text-neutral-500">solid = left of CL · dashed = right · colour = distance from CL</span>
    </div>
  );

  return (
    <div id="skid-profile" className="px-4 py-3 bg-card border-t border-border" style={{ scrollMarginTop: 84 }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2">
        <h3 className="panel-label">Friction profile · {runway.label}</h3>
        <span className="text-[11px] text-muted-foreground">Drag on the plot to zoom · click to select a unit</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        {!narrow && (
          <div className="flex items-center gap-2">
            <span className="panel-label">View</span>
            <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && onView(v as ProfileView)}>
              <ToggleGroupItem value="one">One lane</ToggleGroupItem>
              <ToggleGroupItem value="compare">Compare</ToggleGroupItem>
              <ToggleGroupItem value="all">All lanes</ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}

        {narrow ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="panel-label">Lane</span>
            <select
              value={lanes[0]}
              onChange={(e) => onLanes([e.target.value as LaneCode])}
              className="h-8 rounded-md border border-input bg-card px-2 text-sm text-foreground"
            >
              {LANE_ORDER.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="panel-label">Lane</span>
            <ToggleGroup
              type="multiple"
              variant="outline"
              size="sm"
              value={chipValue}
              onValueChange={() => undefined}
            >
              {LANE_ORDER.slice(0, 4).map((c) => (
                <ToggleGroupItem key={c} value={c} aria-label={`Lane ${c}`} onClick={() => clickLane(c)}>
                  {c}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ToggleGroup type="multiple" variant="outline" size="sm" value={chipValue} onValueChange={() => undefined}>
              {LANE_ORDER.slice(4).map((c) => (
                <ToggleGroupItem key={c} value={c} aria-label={`Lane ${c}`} onClick={() => clickLane(c)}>
                  {c}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ToggleGroup type="single" variant="outline" size="sm" value={view === "all" ? "all" : ""} onValueChange={(v) => v === "all" && onView("all")}>
              <ToggleGroupItem value="all">All</ToggleGroupItem>
            </ToggleGroup>
            <button className={btn} title={TRACK_HINT} onClick={() => faaTrack(FAA_TRACKS.withTest)}>
              FAA tracks · landing {runway.testEnd}
            </button>
            <button className={btn} title={TRACK_HINT} onClick={() => faaTrack(FAA_TRACKS.againstTest)}>
              FAA tracks · landing {runway.farEnd}
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="panel-label">Overlays</span>
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            value={overlayKeys.filter((o) => overlays[o])}
            onValueChange={(on) => onOverlays(Object.fromEntries(overlayKeys.map((o) => [o, on.includes(o)])) as unknown as Overlays)}
            className="flex-wrap"
          >
            {overlayKeys.map((o) => (
              <ToggleGroupItem
                key={o}
                value={o}
                // Segments and thirds are single-lane printout items.
                disabled={(o === "segments" || o === "thirds") && view !== "one"}
              >
                {OVERLAY_LABELS[o]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => onXDomain(null)} disabled={xDomain === null} className={btn}>
            Full runway
          </button>
          <button onClick={unitZoom} disabled={selectedUnit === null} className={btn}>
            Selected unit ± 150 m
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={exportCsv} disabled={!rt || !ma} className={`${btn} inline-flex items-center gap-1.5`} title="Download the visible 1 m readings as CSV">
            <Download size={12} /> Download CSV
          </button>
          <button
            onClick={exportSvg}
            disabled={!rt || plotWidth === 0}
            className={`${btn} inline-flex items-center gap-1.5`}
            title="Download the plot as SVG, with title and legend"
          >
            <Download size={12} /> Download SVG
          </button>
          <button
            onClick={() => setPrinting(true)}
            disabled={!rt || !ma}
            className={`${btn} inline-flex items-center gap-1.5`}
            title="Print one A4 landscape page per lane of this runway (profile, speed, 500 ft and third averages)"
          >
            <Printer size={12} /> Print (1 page per lane)
          </button>
        </div>
      </div>

      {/* The measuring div is always rendered so the observer attaches before the data arrives. */}
      <div className="rounded-md bg-[#FBFAF7] text-[#1F1F1F] p-3">
        <div ref={plotRef} className="w-full">
          {error ? (
            <p className="py-10 text-sm text-center text-neutral-600 break-words">Failed to load per-meter data: {error}</p>
          ) : loading || !rt || !lane ? (
            <p className="py-10 text-sm text-center text-neutral-600">Loading per-meter readings...</p>
          ) : (
            <>
              <div className="mb-2 text-[12px] leading-snug">
                <p className="font-semibold">{headerLines[0]}</p>
                <p className="text-neutral-600">{headerLines[1]}</p>
              </div>
              {view === "compare" && compareLegend}

              {plotWidth > 0 && view !== "all" && (
                <>
                  <SkidProfileChart
                    rt={rt}
                    lanes={shown}
                    mode={view === "one" ? "one" : "compare"}
                    runway={runway}
                    rows={rows}
                    width={plotWidth}
                    height={chartHeight}
                    domain={domain}
                    overlays={overlays}
                    selectedUnit={selectedUnit}
                    segments={segments}
                    thirds={thirds}
                    onZoom={(d) => onXDomain(clamp(d))}
                    onSelectUnit={onSelectUnit}
                    syncId={SYNC_ONE}
                  />
                  {view === "one" && (
                    <>
                      <div
                        className="flex flex-wrap items-baseline justify-between gap-x-2 text-[11px] text-neutral-600 mt-1"
                        style={{ paddingLeft: Y_AXIS_WIDTH + PROFILE_MARGIN.left }}
                      >
                        <span>
                          Speed (km/h) · grey band = {SKID_SPEED.target} ± {SKID_SPEED.tol}
                        </span>
                        <span style={{ marginRight: profileMargin(plotWidth).right }}>
                          Outside {SKID_SPEED.target} ± {SKID_SPEED.tol} km/h: {lane.stats.rows_outside_speed_tol} m
                        </span>
                      </div>
                      <SkidSpeedStrip rows={rows} laneKey={laneKey(lane.lane)} width={plotWidth} domain={domain} syncId={SYNC_ONE} />
                    </>
                  )}
                </>
              )}

              {plotWidth > 0 &&
                view === "all" &&
                shown.map((t, i) => {
                  // Plot height is fixed; only the margins differ (top axis on the first chart, x axis on the last).
                  const topMargin = i === 0 ? 28 : 6;
                  const bottomMargin = i === shown.length - 1 ? 38 : 4;
                  return (
                  <div key={t.lane} className="flex items-start">
                    <div
                      className="shrink-0 pr-2 text-right text-[11px] leading-tight"
                      style={{ width: LABEL_W, paddingTop: topMargin + MINI_PLOT / 2 - 14 }}
                    >
                      <div className="font-semibold">{t.lane}</div>
                      <div className="text-neutral-600">μ̄ {muText(t.stats.mean_mu)}</div>
                    </div>
                    <SkidProfileChart
                      rt={rt}
                      lanes={[t]}
                      mode="mini"
                      runway={runway}
                      rows={rows}
                      width={plotWidth - LABEL_W}
                      height={MINI_PLOT + topMargin + bottomMargin}
                      domain={domain}
                      overlays={overlays}
                      selectedUnit={selectedUnit}
                      onZoom={(d) => onXDomain(clamp(d))}
                      // Clicking a small chart opens that lane in One lane view (and selects the unit under the click).
                      onSelectUnit={(unit) => {
                        onView("one");
                        onLanes([t.lane]);
                        onSelectUnit(unit);
                      }}
                      syncId={SYNC_ALL}
                      showTopAxis={i === 0}
                      showXAxis={i === shown.length - 1}
                      showFaaLabels={i === 0}
                    />
                  </div>
                  );
                })}
            </>
          )}
        </div>
      </div>

      {rt && lane &&
        (view === "one" ? (
          <SkidSegmentTable rt={rt} lane={lane} runway={runway} segments={segments} thirds={thirds} faa={faa} onZoomTo={(d) => onXDomain(clamp(d))} />
        ) : (
          <SkidSegmentMatrix rt={rt} lanes={shown} onZoomTo={(d) => onXDomain(clamp(d))} />
        ))}
      {printing && <SkidPrint runway={runway} traceState={traceState} onDone={stopPrinting} />}
    </div>
  );
}
