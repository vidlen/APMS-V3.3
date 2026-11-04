import { Flag, X } from "lucide-react";
import { BBI_CLASS_META, classifyBbi } from "@/config/bbi";
import type { BbiRunwayData, BbiUnit } from "@/types/bbi";
import { START_OF_RUN_HINT, bbiText, fmtX, offsetText, type BbiRunwayMeta } from "./bbi-ui";

const num = (v: number | null, d: number) => (v === null ? "—" : v.toFixed(d));
const th = "font-medium py-1.5 px-1 text-right align-bottom whitespace-nowrap";
const thLeft = "font-medium py-1.5 px-1 text-left align-bottom whitespace-nowrap";
const td = "py-1.5 px-1 text-right font-mono whitespace-nowrap";
const tdLeft = "py-1.5 px-1 text-left font-mono whitespace-nowrap";

interface BbiUnitPanelProps {
  data: BbiRunwayData;
  runway: BbiRunwayMeta;
  unit: BbiUnit | null;
  onClose: () => void;
  /** Open this line in the profile, zoomed to the unit ± 50 m. */
  onShowInProfile: (line: string, domain: [number, number]) => void;
}

export default function BbiUnitPanel({ data, runway, unit, onClose, onShowInProfile }: BbiUnitPanelProps) {
  if (!unit) {
    return <div className="px-5 py-10 text-sm text-muted-foreground text-center">Select a sample unit on the map or the profile.</div>;
  }
  const g = unit.governing;
  const cls = classifyBbi(g?.bbi ?? null, g?.zone ?? null);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-condensed text-lg font-semibold tracking-tight text-foreground leading-tight">Unit {unit.unit}</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
            {fmtX(unit.x_from_06_start_m)}–{fmtX(unit.x_from_06_end_m)} m from threshold {runway.startEnd}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1 -m-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Clear selected unit"
          title="Clear selection"
        >
          <X size={16} />
        </button>
      </div>

      {g ? (
        <>
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="font-mono text-4xl font-bold tabular-nums text-foreground leading-none">{bbiText(g.bbi)}</span>
              <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium border border-border" style={{ backgroundColor: BBI_CLASS_META[cls].color, color: BBI_CLASS_META[cls].text }}>
                {g.zone}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Governing: <span className="font-mono font-medium text-foreground">{g.line}</span> · bump height {g.h_cm.toFixed(2)} cm · bump length {g.bump_length_m.toFixed(2)} m · straightedge{" "}
              {g.straightedge_m.toFixed(2)} m
            </p>
            {g.start_of_run && (
              <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1" title={START_OF_RUN_HINT}>
                <Flag size={11} className="shrink-0" /> {START_OF_RUN_HINT}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">
              G flag: BBI {unit.g_flag ? ">" : "≤"} 1.0 (stored for the SKG consequence axis; not used in Risk yet)
            </p>
          </div>

          <div>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-[11px] tabular-nums">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[.05em] text-muted-foreground border-b border-border">
                    <th className={thLeft}>Line</th>
                    <th className={thLeft}>Dir</th>
                    <th className={th}>Offset*</th>
                    <th className={th}>BBI</th>
                    <th className={thLeft}>Zone</th>
                    <th className={th}>H (cm)</th>
                    <th className={th}>L (m)</th>
                    <th className={th}>SE (m)</th>
                    <th className={th}>&gt;1.0</th>
                    <th className={th}>At (m)</th>
                  </tr>
                </thead>
                <tbody>
                  {unit.lines.map((l, i) => {
                    const meta = data.lines[i];
                    const measured = l.bbi_max !== null;
                    return (
                      <tr key={l.line} className={`hairline-row ${g.line === l.line ? "bg-secondary font-medium" : ""}`}>
                        <td className={tdLeft}>
                          <span className="inline-flex items-center gap-1">
                            {l.line}
                            {l.start_of_run && (
                              <span title={START_OF_RUN_HINT} aria-label={START_OF_RUN_HINT}>
                                <Flag size={10} className="text-muted-foreground" />
                              </span>
                            )}
                          </span>
                        </td>
                        <td className={tdLeft}>{meta.direction}</td>
                        <td className={td}>{offsetText(meta.offset_m)}</td>
                        {measured ? (
                          <>
                            <td className={td}>{bbiText(l.bbi_max)}</td>
                            <td className={tdLeft}>{l.zone ?? "—"}</td>
                            <td className={td}>{num(l.h_cm, 2)}</td>
                            <td className={td}>{num(l.bump_length_m, 2)}</td>
                            <td className={td}>{num(l.straightedge_m, 2)}</td>
                            <td className={td}>{l.pct_over_1 === null ? "—" : `${l.pct_over_1.toFixed(1)}%`}</td>
                            <td className={td}>{l.x_from_06_m === null ? "—" : fmtX(l.x_from_06_m)}</td>
                          </>
                        ) : (
                          <td colSpan={7} className="py-1.5 px-1 text-muted-foreground">
                            — <span className="text-[10px]">not measured here</span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              H bump height · L bump length · SE straightedge · &gt;1.0 share of points above BBI 1.0 · At position of the line's maximum, metres from threshold {runway.startEnd}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">* pass offset from pass 1, + = south; provisional</p>
          </div>

          <button
            onClick={() => onShowInProfile(g.line, [Math.max(0, unit.x_from_06_start_m - 50), Math.min(Math.ceil(data.axis.length_m), unit.x_from_06_end_m + 50)])}
            className="h-7 px-2.5 rounded-md text-[11px] font-medium border border-border text-foreground hover:bg-secondary transition-colors"
            title="Open the governing line in the profile, zoomed to this unit ± 50 m"
          >
            Show in profile
          </button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Not covered by any processed line (within the trimmed run ends).</p>
      )}
    </div>
  );
}
