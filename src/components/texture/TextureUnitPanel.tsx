import { useState } from "react";
import { toast } from "sonner";
import { Copy, X } from "lucide-react";
import { TEXTURE_CLASS_META, classifyTexture } from "@/config/texture";
import type { TextureRunwayData, TextureUnit } from "@/types/texture";
import { fmtX, mmText, offsetText, shortImage, unitBandText, type TextureRunwayMeta } from "./texture-ui";

const th = "font-medium py-1.5 px-1 text-right align-bottom";
const td = "py-1.5 px-1 text-right font-mono whitespace-nowrap";
/** The table of values above 2 mm folds above this many rows. */
const FOLD_ABOVE = 5;
const WINDOW_M = 50;

const yesNo = (v: boolean | null) => (v === null ? "—" : v ? "yes" : "no");

interface TextureUnitPanelProps {
  data: TextureRunwayData;
  runway: TextureRunwayMeta;
  unit: TextureUnit | null;
  onClose: () => void;
  /** Zoom the along-runway chart to the unit ± 50 m. */
  onShowInChart: (domain: [number, number]) => void;
}

export default function TextureUnitPanel({ data, runway, unit, onClose, onShowInChart }: TextureUnitPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!unit) {
    return <div className="px-5 py-10 text-sm text-muted-foreground text-center">Select a sample unit on the map or the chart.</div>;
  }
  const { keel, full, k_flags, high_values: high } = unit;
  const cls = classifyTexture(keel.etd_mm);
  const zoneLabel = data.zones[unit.zone - 1].label;
  const shownHigh = expanded || high.length <= FOLD_ABOVE ? high : high.slice(0, FOLD_ABOVE);
  const copy = (name: string) => {
    void navigator.clipboard.writeText(name).then(
      () => toast.success("Image name copied."),
      () => toast.error("Could not copy the image name."),
    );
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-condensed text-lg font-semibold tracking-tight text-foreground leading-tight">Unit {unit.unit}</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
            {fmtX(unit.x_mid_m)} m from threshold {runway.startEnd} · zone {unit.zone} ({zoneLabel})
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

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-xs">
        <dt className="panel-label pt-0.5">Keel ±{data.keel.half_width_m} m</dt>
        <dd className="min-w-0">
          {keel.n > 0 ? (
            <>
              <div className="tabular-nums text-foreground">
                n {keel.n} · MPD {mmText(keel.mpd_mm)} mm · SD {mmText(keel.sd_mm)} mm · ETD <strong className="font-semibold">{mmText(keel.etd_mm)} mm</strong>
              </div>
              {cls !== "noData" && (
                <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground mt-1">
                  <span className="mt-0.5 w-2.5 h-2.5 rounded-sm shrink-0 border border-border" style={{ backgroundColor: TEXTURE_CLASS_META[cls].color }} />
                  {unitBandText(cls)}
                </div>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">No band value within ±{data.keel.half_width_m} m of the centreline in this unit.</span>
          )}
        </dd>

        <dt className="panel-label pt-0.5">Full width</dt>
        <dd className="tabular-nums text-foreground">
          n {full.n} · MPD {mmText(full.mpd_mm)} mm · ETD {mmText(full.etd_mm)} mm
        </dd>

        <dt className="panel-label pt-0.5">K flags</dt>
        <dd>
          <div className="text-foreground">
            Minimum (ETD &lt; {data.k_rule.minimum_mm.toFixed(2)}): {yesNo(k_flags.minimum)} · Planning (ETD &lt; {data.k_rule.planning_mm.toFixed(2)}): {yesNo(k_flags.planning)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">stored for the SKG consequence axis; not used in Risk yet</div>
        </dd>
      </dl>

      {unit.passes.length > 0 && (
        <div>
          <h4 className="panel-label mb-1">Keel values by pass</h4>
          <p className="text-xs tabular-nums text-foreground">{unit.passes.map((p) => `P${p.pass} ${p.n_keel}`).join(" · ")}</p>
        </div>
      )}

      {high.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-foreground mb-1">
            Values above 2 mm: {high.length} ({high.filter((v) => v.keel).length} in keel). Check the LCMS images.
          </h4>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-[11px] tabular-nums">
              <thead>
                <tr className="text-[10px] uppercase tracking-[.05em] text-muted-foreground border-b border-border">
                  <th className={th}>From {runway.startEnd} (m)</th>
                  <th className={th}>Offset (m)</th>
                  <th className={th}>Pass</th>
                  <th className={th}>Band</th>
                  <th className={th}>MPD (mm)</th>
                  <th className="font-medium py-1.5 pl-2 pr-1 text-left align-bottom">Image</th>
                </tr>
              </thead>
              <tbody>
                {shownHigh.map((v) => (
                  <tr key={`${v.segment_id}-${v.band}`} className={`hairline-row ${v.keel ? "bg-secondary font-medium" : ""}`}>
                    <td className={td}>{v.x_m.toFixed(2)}</td>
                    <td className={td}>{offsetText(v.offset_m)}</td>
                    <td className={td}>{v.pass}</td>
                    <td className={td}>{v.band}</td>
                    <td className={td}>{v.mpd_mm.toFixed(2)}</td>
                    <td className="py-1.5 pl-2 pr-1 text-left font-mono whitespace-nowrap">
                      <button
                        onClick={() => copy(v.image)}
                        title={`${v.image} (click to copy)`}
                        aria-label={`Copy image name ${v.image}`}
                        className="inline-flex items-center gap-1 rounded-sm hover:text-foreground text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {shortImage(v.image)}
                        <Copy size={10} className="shrink-0" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {high.length > FOLD_ABOVE && (
            <button onClick={() => setExpanded((e) => !e)} className="mt-1 text-[11px] font-medium text-foreground underline underline-offset-2">
              {expanded ? "Show fewer" : `Show all ${high.length}`}
            </button>
          )}
          {high.some((v) => v.keel) && <p className="text-[10px] text-muted-foreground mt-1">Shaded rows are in the keel.</p>}
        </div>
      )}

      <button
        onClick={() => onShowInChart([Math.max(0, unit.x_mid_m - WINDOW_M), Math.min(data.axis.length_m, unit.x_mid_m + WINDOW_M)])}
        className="h-7 px-2.5 rounded-md text-[11px] font-medium border border-border text-foreground hover:bg-secondary transition-colors"
        title="Zoom the along-runway chart to this unit ± 50 m"
      >
        Show in chart
      </button>
    </div>
  );
}
