import { useMemo } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useElementWidth } from "@/hooks/useElementWidth";
import type { BbiTraceState } from "@/hooks/useBbiTrace";
import { profileRows } from "@/lib/bbi";
import type { BbiProfileView } from "@/lib/bbi-url";
import type { BbiLineMeta, BbiRunwayData, BbiUnit } from "@/types/bbi";
import BbiProfileChart, { type ChartLine } from "./BbiProfileChart";
import { lineStyle, type BbiRunwayMeta, type XDomain } from "./bbi-ui";

const btn =
  "h-8 px-3 rounded-md text-xs font-medium border border-border text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:pointer-events-none";
const MIN_COMPARE = 2;
const MAX_COMPARE = 4;

function LineKey({ meta }: { meta: BbiLineMeta }) {
  const s = lineStyle(meta);
  return (
    <svg width="18" height="8" aria-hidden className="shrink-0">
      <line x1="0" y1="4" x2="18" y2="4" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dash} />
    </svg>
  );
}

interface BbiProfileProps {
  data: BbiRunwayData;
  runway: BbiRunwayMeta;
  selectedUnit: BbiUnit | null;
  view: BbiProfileView;
  onView: (view: BbiProfileView) => void;
  /** Line of One line (first) and Compare. All lines always draws every line. */
  lines: string[];
  onLines: (lines: string[]) => void;
  xDomain: XDomain;
  onXDomain: (domain: XDomain) => void;
  narrow: boolean;
  onSelectUnit: (unit: number) => void;
  traceState: BbiTraceState;
}

// BBI along the runway for one line, a few lines overlaid, or all of them.
export default function BbiProfile({ data, runway, selectedUnit, view: viewProp, onView, lines, onLines, xDomain, onXDomain, narrow, onSelectUnit, traceState }: BbiProfileProps) {
  const { trace, loading, error } = traceState;
  const [plotRef, plotWidth] = useElementWidth<HTMLDivElement>();

  // Phones get One line only.
  const view: BbiProfileView = narrow ? "one" : viewProp;
  const shownCodes = view === "all" ? data.lines.map((l) => l.code) : view === "one" ? lines.slice(0, 1) : lines;
  const shown: ChartLine[] = trace
    ? shownCodes.flatMap((code) => {
        const meta = data.lines.find((l) => l.code === code);
        const t = trace.lines.find((l) => l.line === code);
        return meta && t ? [{ meta, trace: t }] : [];
      })
    : [];

  const length = Math.ceil(data.axis.length_m);
  const domain: [number, number] = xDomain ?? [0, length];
  const rows = useMemo(
    () => (shown.length > 0 ? profileRows(shown.map((l) => l.trace), domain) : []),
    // `shown` and `domain` are rebuilt each render; their keys are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trace, shownCodes.join(), domain[0], domain[1]],
  );

  const clickLine = (code: string) => {
    if (view === "compare") {
      const next = lines.includes(code) ? lines.filter((l) => l !== code) : [...lines, code];
      if (next.length >= MIN_COMPARE && next.length <= MAX_COMPARE) onLines(next);
    } else {
      // From One line this just switches line; from All lines it also drops back to One line.
      if (view === "all") onView("one");
      onLines([code]);
    }
  };
  const chipValue = view === "all" ? data.lines.map((l) => l.code) : view === "one" ? lines.slice(0, 1) : lines;
  const clamp = (d: [number, number]): XDomain => [Math.max(0, d[0]), Math.min(length, d[1])];

  return (
    <div id="bbi-profile" className="px-4 py-3 bg-card border-t border-border" style={{ scrollMarginTop: 56 }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2">
        <h3 className="panel-label">BBI profile · {runway.label}</h3>
        <span className="text-[11px] text-muted-foreground">Drag on the plot to zoom · click to select a unit</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        {!narrow && (
          <div className="flex items-center gap-2">
            <span className="panel-label">View</span>
            <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && onView(v as BbiProfileView)}>
              <ToggleGroupItem value="one">One line</ToggleGroupItem>
              <ToggleGroupItem value="compare">Compare</ToggleGroupItem>
              <ToggleGroupItem value="all">All lines</ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}

        {narrow ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="panel-label">Line</span>
            <select value={lines[0]} onChange={(e) => onLines([e.target.value])} className="h-8 rounded-md border border-input bg-card px-2 text-sm text-foreground">
              {data.lines.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.code}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="panel-label">Line</span>
            <ToggleGroup type="multiple" variant="outline" size="sm" value={chipValue} onValueChange={() => undefined}>
              {data.lines.map((l) => (
                <ToggleGroupItem key={l.code} value={l.code} aria-label={`Line ${l.code}`} onClick={() => clickLine(l.code)} className="gap-1.5">
                  <LineKey meta={l} />
                  {l.code}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}

        <button onClick={() => onXDomain(null)} disabled={xDomain === null} className={btn}>
          Reset zoom
        </button>
      </div>

      {/* The measuring div is always rendered so the observer attaches before the data arrives. */}
      <div className="rounded-md bg-[#FBFAF7] text-[#1F1F1F] p-3">
        <div ref={plotRef} className="w-full">
          {error ? (
            <p className="py-10 text-sm text-center text-neutral-600 break-words">Failed to load the 0.25 m data: {error}</p>
          ) : loading || !trace ? (
            <p className="py-10 text-sm text-center text-neutral-600">Loading the 0.25 m points...</p>
          ) : (
            plotWidth > 0 &&
            shown.length > 0 && (
              <BbiProfileChart
                lines={shown}
                units={data.units}
                runway={runway}
                rows={rows}
                width={plotWidth}
                height={narrow ? 280 : 340}
                domain={domain}
                selectedUnit={selectedUnit}
                onZoom={(d) => onXDomain(clamp(d))}
                onSelectUnit={onSelectUnit}
              />
            )
          )}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5">
        Colour = pass, solid = L side, dashed = R side. Above 600 m the plot shows the maximum per 1 m, so peaks stay visible. Orange dots: Excessive or Unacceptable points.
      </p>
    </div>
  );
}
