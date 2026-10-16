import { useState } from "react";
import { Check, Copy, CircleMinus, Eye, OctagonAlert, TriangleAlert } from "lucide-react";
import { classifySkid, SKID_CLASS_META, type SkidClass } from "@/config/skid";
import { stationOf, unitAtStation, xOf, type Faa320Result, type Faa320Status, type SkidSegment } from "@/lib/skid-trace";
import type { SkidLaneTrace, SkidRunwayTrace } from "@/types/skid";
import { muText, type RunwayMeta } from "./skid-ui";

const CLASS_SHORT: Record<SkidClass, string> = {
  belowMinimum: "< 0.50",
  belowMaintenance: "< 0.60",
  aboveMaintenance: "≥ 0.60",
  newDesign: "≥ 0.82",
  noData: "—",
};

// Shapes and words, not red/yellow/green, so the status survives colour-blindness.
const FAA_STATUS: Partial<Record<Faa320Status, { label: string; ref: string; Icon: typeof Eye }>> = {
  immediate: { label: "Immediate", ref: "3-20.c: below minimum and adjacent segments below maintenance planning", Icon: OctagonAlert },
  extensive: { label: "Extensive", ref: "3-20.b: below maintenance planning over 304.8 m (1,000 ft) or more", Icon: TriangleAlert },
  belowMinimum: { label: "Below min.", ref: "Below minimum, but 3-20.b and 3-20.c are not met", Icon: CircleMinus },
  monitor: { label: "Monitor", ref: "3-20.a: below maintenance planning in a single segment", Icon: Eye },
};

interface Line {
  key: string;
  label: string;
  partial: boolean;
  dist: string;
  x: [number, number] | null;
  units: string;
  n: number;
  mean: number | null;
  speed: number | null;
  faa: Faa320Result | null;
  zoom: [number, number] | null;
}

interface SkidSegmentTableProps {
  rt: SkidRunwayTrace;
  lane: SkidLaneTrace;
  runway: RunwayMeta;
  segments: SkidSegment[];
  thirds: SkidSegment[];
  faa: Faa320Result[];
  /** Zoom the profile to this x range. */
  onZoomTo: (domain: [number, number]) => void;
}

const num = (v: number | null, digits: number) => (v === null ? "—" : v.toFixed(digits));

export default function SkidSegmentTable({ rt, lane, runway, segments, thirds, faa, onZoomTo }: SkidSegmentTableProps) {
  const [copied, setCopied] = useState(false);
  const last = rt.unit_bounds.last_end_m;

  const describe = (s: SkidSegment, key: string, label: string, result: Faa320Result | null): Line => {
    const xa = xOf(rt, lane, s.dFrom - lane.d_first) - 0.5;
    const xb = xOf(rt, lane, s.dTo - lane.d_first) + 0.5;
    const u1 = unitAtStation(rt, stationOf(lane, s.dFrom - lane.d_first));
    const u2 = unitAtStation(rt, stationOf(lane, s.dTo - lane.d_first));
    return {
      key,
      label,
      partial: s.partial,
      dist: `${s.dFrom.toLocaleString("en-US")}–${s.dTo.toLocaleString("en-US")}`,
      x: [xa, xb],
      units: u1 === null || u2 === null ? "—" : `${u1}–${u2}`,
      n: s.n,
      mean: s.mean,
      speed: s.meanSpeed,
      faa: result,
      zoom: [Math.max(0, xa - 50), Math.min(last, xb + 50)],
    };
  };

  const thirdLabel = (j: number) => `Third ${j + 1}${j === 0 ? ` (${runway.testEnd} end)` : j === 2 ? ` (${runway.farEnd} end)` : ""}`;
  const lines: Line[] = [
    ...segments.map((s, j) => describe(s, `seg-${j}`, String(j + 1), faa[j])),
    ...thirds.map((s, j) => ({ ...describe(s, `third-${j}`, thirdLabel(j), null), zoom: null })),
    {
      key: "run",
      label: "Whole run",
      partial: false,
      dist: `1–${lane.length_m.toLocaleString("en-US")}`,
      x: null,
      units: "—",
      n: lane.stats.rows - lane.stats.mu_null,
      mean: lane.stats.mean_mu,
      speed: lane.stats.mean_speed_kmh,
      faa: null,
      zoom: null,
    },
  ];

  const copyCsv = () => {
    const header = "segment,distance_from_m,distance_to_m,x_from_m,x_to_m,units,n,mu_avg,speed_avg_kmh,class,faa_3_20,within_0.06_of_threshold";
    const body = lines.map((l) => {
      const [d1, d2] = l.dist.replaceAll(",", "").split("–");
      return [
        l.label,
        d1,
        d2,
        l.x ? Math.round(l.x[0]) : "",
        l.x ? Math.round(l.x[1]) : "",
        l.units,
        l.n,
        l.mean === null ? "" : l.mean.toFixed(4),
        l.speed === null ? "" : l.speed.toFixed(1),
        classifySkid(l.mean),
        l.faa?.status ?? "",
        l.faa ? (l.faa.borderline ? "yes" : "no") : "",
      ].join(",");
    });
    void navigator.clipboard.writeText([header, ...body].join("\n")).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h4 className="panel-label">152 m segments · {lane.lane} · FAA 3-20</h4>
        <button
          onClick={copyCsv}
          className="h-7 inline-flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-medium border border-border text-foreground hover:bg-secondary transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy CSV"}
        </button>
      </div>

      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full min-w-[760px] text-xs tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-[.07em] text-muted-foreground border-b border-border">
              <th className="text-left font-medium py-1.5 pr-2">#</th>
              <th className="text-right font-medium px-2">DISTANCE (m)</th>
              <th className="text-right font-medium px-2">x (m)</th>
              <th className="text-right font-medium px-2">Units</th>
              <th className="text-right font-medium px-2">n</th>
              <th className="text-right font-medium px-2">μ avg</th>
              <th className="text-right font-medium px-2">Speed avg</th>
              <th className="text-left font-medium px-2">Class</th>
              <th className="text-left font-medium px-2">FAA 3-20</th>
              <th className="text-left font-medium px-2" title="Within ±0.06 of a threshold: inside device repeatability (App. 3 par. 1.a(5))">
                ±0.06
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const cls = classifySkid(l.mean);
              const status = l.faa ? FAA_STATUS[l.faa.status] : undefined;
              const sep = l.key.startsWith("third-0") || l.key === "run";
              return (
                <tr
                  key={l.key}
                  onClick={l.zoom ? () => onZoomTo(l.zoom as [number, number]) : undefined}
                  className={`hairline-row ${l.zoom ? "cursor-pointer hover:bg-secondary" : ""} ${sep ? "border-t border-border" : ""} ${idx >= segments.length ? "text-muted-foreground" : ""}`}
                  title={l.zoom ? "Zoom the profile to this segment" : undefined}
                >
                  <td className="py-1.5 pr-2 text-left whitespace-nowrap">
                    {l.label}
                    {l.partial && <span className="ml-1.5 text-[9px] uppercase tracking-wide text-muted-foreground">partial</span>}
                  </td>
                  <td className="text-right px-2 font-mono">{l.dist}</td>
                  <td className="text-right px-2 font-mono">{l.x ? `${Math.round(l.x[0])}–${Math.round(l.x[1])}` : "—"}</td>
                  <td className="text-right px-2 font-mono">{l.units}</td>
                  <td className="text-right px-2 font-mono">{l.n}</td>
                  <td className="text-right px-2 font-mono text-foreground">{muText(l.mean)}</td>
                  <td className="text-right px-2 font-mono">{num(l.speed, 1)}</td>
                  <td className="px-2">
                    <span
                      className="inline-block px-1.5 py-0.5 rounded-sm text-[10px] font-medium border border-border"
                      style={{ backgroundColor: SKID_CLASS_META[cls].color, color: SKID_CLASS_META[cls].text }}
                      title={SKID_CLASS_META[cls].label}
                    >
                      {CLASS_SHORT[cls]}
                    </span>
                  </td>
                  <td className="px-2 whitespace-nowrap">
                    {status ? (
                      <span className="inline-flex items-center gap-1 text-foreground" title={status.ref}>
                        <status.Icon size={12} /> {status.label}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2">{l.faa?.borderline ? <span title="Within ±0.06 of a threshold">±</span> : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground mt-2 max-w-[90ch]">
        Segments are fixed 152.4 m (500 ft) steps from the start of recording, as on the device printout (FAA AC 150/5320-12C App. 3 par. 1.a(3), 1.a(9)).
        FAA 3-20 flags are an aid for interpretation, not an official assessment. Values within ±0.06 of a threshold are within device repeatability (App. 3
        par. 1.a(5)).
      </p>
    </div>
  );
}
