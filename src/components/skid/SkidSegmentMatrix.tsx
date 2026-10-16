import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { classifySkid, SKID_CLASS_META } from "@/config/skid";
import { evaluateFaa320, fixedSegments, xOf } from "@/lib/skid-trace";
import type { SkidLaneTrace, SkidRunwayTrace } from "@/types/skid";
import { FAA_STATUS, fmtInt, muText } from "./skid-ui";

interface SkidSegmentMatrixProps {
  rt: SkidRunwayTrace;
  lanes: SkidLaneTrace[];
  /** Zoom the profile to this x range. */
  onZoomTo: (domain: [number, number]) => void;
}

// Segments × lanes for the Compare and All lanes views: μ avg per cell, coloured
// by class, with the FAA 3-20 flag of that lane's segment.
export default function SkidSegmentMatrix({ rt, lanes, onZoomTo }: SkidSegmentMatrixProps) {
  const [copied, setCopied] = useState(false);
  const last = rt.unit_bounds.last_end_m;

  const perLane = useMemo(
    () =>
      lanes.map((t) => {
        const segs = fixedSegments(t);
        return { t, segs, faa: evaluateFaa320(segs) };
      }),
    [lanes],
  );
  const ref = perLane[0];
  const rows = ref.segs.map((s, j) => {
    const cells = perLane.map((p) => ({ mean: p.segs[j].mean, faa: p.faa[j] }));
    let lowest: number | null = null;
    for (let i = 0; i < cells.length; i++) {
      const m = cells[i].mean;
      if (m !== null && (lowest === null || m < (cells[lowest].mean as number))) lowest = i;
    }
    const xa = xOf(rt, ref.t, s.dFrom - ref.t.d_first) - 0.5;
    const xb = xOf(rt, ref.t, s.dTo - ref.t.d_first) + 0.5;
    return { j, s, cells, lowest, zoom: [Math.max(0, xa - 50), Math.min(last, xb + 50)] as [number, number] };
  });

  const copyCsv = () => {
    const header = ["segment", "distance_from_m", "distance_to_m", ...lanes.flatMap((l) => [`${l.lane}_mu`, `${l.lane}_faa_3_20`]), "lowest_lane"].join(",");
    const body = rows.map((r) =>
      [
        r.j + 1,
        r.s.dFrom,
        r.s.dTo,
        ...r.cells.flatMap((c) => [c.mean === null ? "" : c.mean.toFixed(4), c.faa.status]),
        r.lowest === null ? "" : lanes[r.lowest].lane,
      ].join(","),
    );
    void navigator.clipboard.writeText([header, ...body].join("\n")).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h4 className="panel-label">152 m segments · {lanes.length} lanes · FAA 3-20</h4>
        <button
          onClick={copyCsv}
          className="h-7 inline-flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-medium border border-border text-foreground hover:bg-secondary transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy CSV"}
        </button>
      </div>

      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-xs tabular-nums" style={{ minWidth: 200 + lanes.length * 78 }}>
          <thead>
            <tr className="text-[10px] uppercase tracking-[.07em] text-muted-foreground border-b border-border">
              <th className="text-left font-medium py-1.5 pr-2">#</th>
              <th className="text-right font-medium px-2">DISTANCE (m)</th>
              {lanes.map((l) => (
                <th key={l.lane} className="text-center font-medium px-1.5">
                  {l.lane}
                </th>
              ))}
              <th className="text-left font-medium px-2">Lowest lane</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.j}
                onClick={() => onZoomTo(r.zoom)}
                className="hairline-row cursor-pointer hover:bg-secondary"
                title="Zoom the profile to this segment"
              >
                <td className="py-1.5 pr-2 whitespace-nowrap">
                  {r.j + 1}
                  {r.s.partial && <span className="ml-1.5 text-[9px] uppercase tracking-wide text-muted-foreground">partial</span>}
                </td>
                <td className="text-right px-2 font-mono">
                  {fmtInt(r.s.dFrom)}–{fmtInt(r.s.dTo)}
                </td>
                {r.cells.map((c, i) => {
                  const cls = classifySkid(c.mean);
                  const status = FAA_STATUS[c.faa.status];
                  return (
                    <td key={lanes[i].lane} className="px-1.5 text-center whitespace-nowrap">
                      <span
                        className="inline-block min-w-[36px] px-1.5 py-0.5 rounded-sm font-mono text-[11px] border border-border"
                        style={{ backgroundColor: SKID_CLASS_META[cls].color, color: SKID_CLASS_META[cls].text }}
                        title={`${SKID_CLASS_META[cls].label}${c.faa.borderline ? " · within ±0.06 of a threshold" : ""}`}
                      >
                        {muText(c.mean)}
                      </span>
                      {status && (
                        <span className="inline-block ml-1 align-middle text-foreground" title={status.ref}>
                          <status.Icon size={12} aria-label={status.label} />
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 font-mono text-foreground">{r.lowest === null ? "—" : lanes[r.lowest].lane}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground mt-2 max-w-[90ch]">
        Segments are fixed 152.4 m (500 ft) steps from the start of recording, as on the device printout (FAA AC 150/5320-12C App. 3 par. 1.a(3), 1.a(9)).
        FAA 3-20 flags are an aid for interpretation, not an official assessment. Values within ±0.06 of a threshold are within device repeatability (App. 3
        par. 1.a(5)). Icons: octagon = immediate, triangle = extensive, minus = below minimum only, eye = monitor.
      </p>
    </div>
  );
}
