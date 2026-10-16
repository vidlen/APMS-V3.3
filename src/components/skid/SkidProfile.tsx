import { useMemo } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LANE_ORDER, SKID_SPEED } from "@/config/skid";
import { useElementWidth } from "@/hooks/useElementWidth";
import { useSkidTrace } from "@/hooks/useSkidTrace";
import { evaluateFaa320, fixedSegments, laneKey, profileRows, thirds as thirdsOf, unitXRange } from "@/lib/skid-trace";
import type { LaneCode } from "@/types/skid";
import SkidProfileChart from "./SkidProfileChart";
import SkidSpeedStrip from "./SkidSpeedStrip";
import SkidSegmentTable from "./SkidSegmentTable";
import {
  OVERLAY_LABELS,
  PROFILE_MARGIN,
  Y_AXIS_WIDTH,
  laneDescription,
  muText,
  profileMargin,
  wibStamp,
  type Overlays,
  type RunwayMeta,
  type XDomain,
} from "./skid-ui";

const SYNC_ID = "skid-profile-one";
const MAX_ROWS = 1500;

interface SkidProfileProps {
  runway: RunwayMeta;
  /** Selected unit on this runway, or null. */
  selectedUnit: number | null;
  lane: LaneCode;
  onLane: (lane: LaneCode) => void;
  xDomain: XDomain;
  onXDomain: (domain: XDomain) => void;
  overlays: Overlays;
  onOverlays: (overlays: Overlays) => void;
  narrow: boolean;
  onSelectUnit: (unit: number) => void;
}

// "Vehicle view": the friction trace of one lane as on the test vehicle's
// screen and printout (FAA AC 150/5320-12C App. 3 par. 1.a(9)).
export default function SkidProfile({
  runway,
  selectedUnit,
  lane: laneCode,
  onLane,
  xDomain,
  onXDomain,
  overlays,
  onOverlays,
  narrow,
  onSelectUnit,
}: SkidProfileProps) {
  const { trace: rt, ma, loading, error } = useSkidTrace(runway.id);
  const [plotRef, plotWidth] = useElementWidth<HTMLDivElement>();

  const lane = rt?.lanes.find((l) => l.lane === laneCode) ?? null;
  const last = rt?.unit_bounds.last_end_m ?? 0;
  const domain: [number, number] = xDomain ?? [0, last];

  const k = laneKey(laneCode);
  const rows = useMemo(
    () =>
      rt && lane && ma && plotWidth > 0
        ? profileRows(rt, [lane], domain, Math.min(MAX_ROWS, plotWidth - profileMargin(plotWidth).right - Y_AXIS_WIDTH), ma)
        : [],
    // domain is rebuilt each render; its two ends are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rt, lane, ma, plotWidth, domain[0], domain[1]],
  );
  const segments = useMemo(() => (lane ? fixedSegments(lane) : []), [lane]);
  const thirds = useMemo(() => (lane ? thirdsOf(lane) : []), [lane]);
  const faa = useMemo(() => evaluateFaa320(segments), [segments]);

  const clamp = (d: [number, number]): XDomain => [Math.max(0, d[0]), Math.min(last, d[1])];
  const unitZoom = () => {
    if (rt && selectedUnit !== null) {
      const [a, b] = unitXRange(rt, selectedUnit);
      onXDomain(clamp([a - 150, b + 150]));
    }
  };

  const chartHeight = narrow ? 280 : 340;

  return (
    <div id="skid-profile" className="px-4 py-3 bg-card border-t border-border">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2">
        <h3 className="panel-label">Friction profile · {runway.label}</h3>
        <span className="text-[11px] text-muted-foreground">Drag on the plot to zoom · click to select a unit</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        {narrow ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="panel-label">Lane</span>
            <select
              value={laneCode}
              onChange={(e) => onLane(e.target.value as LaneCode)}
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
          <div className="flex items-center gap-2">
            <span className="panel-label">Lane</span>
            <ToggleGroup type="single" variant="outline" size="sm" value={laneCode} onValueChange={(v) => v && onLane(v as LaneCode)}>
              {LANE_ORDER.slice(0, 4).map((l) => (
                <ToggleGroupItem key={l} value={l}>
                  {l}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ToggleGroup type="single" variant="outline" size="sm" value={laneCode} onValueChange={(v) => v && onLane(v as LaneCode)}>
              {LANE_ORDER.slice(4).map((l) => (
                <ToggleGroupItem key={l} value={l}>
                  {l}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="panel-label">Overlays</span>
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            value={(Object.keys(OVERLAY_LABELS) as (keyof Overlays)[]).filter((o) => overlays[o])}
            onValueChange={(on) =>
              onOverlays(Object.fromEntries((Object.keys(OVERLAY_LABELS) as (keyof Overlays)[]).map((o) => [o, on.includes(o)])) as unknown as Overlays)
            }
            className="flex-wrap"
          >
            {(Object.keys(OVERLAY_LABELS) as (keyof Overlays)[]).map((o) => (
              <ToggleGroupItem key={o} value={o}>
                {OVERLAY_LABELS[o]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onXDomain(null)}
            disabled={xDomain === null}
            className="h-8 px-3 rounded-md text-xs font-medium border border-border text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            Full runway
          </button>
          <button
            onClick={unitZoom}
            disabled={selectedUnit === null}
            className="h-8 px-3 rounded-md text-xs font-medium border border-border text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            Selected unit ± 150 m
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
                <p className="font-semibold">
                  {runway.label} · Lane {lane.lane} ({laneDescription(lane.lane)}) · Test direction {rt.survey.direction} ·{" "}
                  {wibStamp(lane.record_start_utc)}
                </p>
                <p className="text-neutral-600">
                  {rt.survey.speed_kmh} km/h · {rt.survey.wetting === "On" ? "self-wetting (1 mm)" : `wetting ${rt.survey.wetting}`} ·{" "}
                  {lane.length_m.toLocaleString("en-US")} m recorded · run mean μ {muText(lane.stats.mean_mu)} · mean speed{" "}
                  {lane.stats.mean_speed_kmh?.toFixed(1) ?? "—"} km/h
                </p>
              </div>

              {plotWidth > 0 && (
                <>
                  <SkidProfileChart
                    rt={rt}
                    lane={lane}
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
                    syncId={SYNC_ID}
                  />
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-[11px] text-neutral-600 mt-1" style={{ paddingLeft: Y_AXIS_WIDTH + PROFILE_MARGIN.left }}>
                    <span>Speed (km/h) · grey band = {SKID_SPEED.target} ± {SKID_SPEED.tol}</span>
                    <span style={{ marginRight: profileMargin(plotWidth).right }}>
                      Outside {SKID_SPEED.target} ± {SKID_SPEED.tol} km/h: {lane.stats.rows_outside_speed_tol} m
                    </span>
                  </div>
                  <SkidSpeedStrip rows={rows} laneKey={k} width={plotWidth} domain={domain} syncId={SYNC_ID} />
                </>
              )}
            </>
          )}
        </div>
      </div>

      {rt && lane && (
        <SkidSegmentTable rt={rt} lane={lane} runway={runway} segments={segments} thirds={thirds} faa={faa} onZoomTo={(d) => onXDomain(clamp(d))} />
      )}
    </div>
  );
}
