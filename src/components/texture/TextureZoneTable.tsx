import { TEXTURE_CLASS_META, TEXTURE_FAA_TEXT, classifyTexture, faaLevel } from "@/config/texture";
import type { TextureZoneChoice } from "@/lib/texture";
import type { TextureRunwayData, TextureZoneId } from "@/types/texture";
import { fmtInt, mmText } from "./texture-ui";

// Alignment is never overridden with a second text-* class: Tailwind's own order would decide which one wins.
const th = "font-medium py-1.5 px-2 text-right align-bottom";
const thLeft = "font-medium py-1.5 px-2 text-left align-bottom";
const td = "py-1.5 px-2 text-right font-mono whitespace-nowrap";

interface TextureZoneTableProps {
  data: TextureRunwayData;
  /** Left out in the admin preview, where the rows are not clickable. */
  zone?: TextureZoneChoice;
  onZone?: (zone: TextureZoneChoice) => void;
}

// The FAA verdict per zone (AC 150/5320-12C par. 3-23b). A click highlights the zone on the map and the charts.
export default function TextureZoneTable({ data, zone, onZone }: TextureZoneTableProps) {
  const toggle = (z: TextureZoneId) => onZone?.(zone === z ? "all" : z);
  return (
    <div className="overflow-x-auto custom-scrollbar">
      <table className="w-full min-w-[820px] text-[11px] tabular-nums">
        <thead>
          <tr className="text-[10px] uppercase tracking-[.05em] text-muted-foreground border-b border-border">
            <th className={thLeft}>Zone</th>
            <th className={th}>Units</th>
            <th className={th}>Keel values</th>
            <th className={th}>MPD (mm)</th>
            <th className={th}>ETD (mm)</th>
            <th className={thLeft}>AC 150/5320-12C par. 3-23b</th>
            <th className={th}>Lowest unit</th>
            <th className={th}>Units &lt; 0.76</th>
            <th className={th}>Units ≥ 1.14</th>
          </tr>
        </thead>
        <tbody>
          {data.zones.map((z) => {
            const selected = zone === z.zone;
            return (
              <tr
                key={z.zone}
                onClick={onZone ? () => toggle(z.zone) : undefined}
                onKeyDown={onZone ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(z.zone)) : undefined}
                tabIndex={onZone ? 0 : undefined}
                aria-selected={onZone ? selected : undefined}
                className={`hairline-row ${onZone ? "cursor-pointer hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" : ""} ${selected ? "bg-secondary font-medium" : ""}`}
              >
                <td className="py-1.5 px-2 text-left whitespace-nowrap">
                  {z.zone} · {z.label}
                </td>
                <td className={td}>
                  {z.units[0]}–{z.units[1]}
                </td>
                <td className={td}>{fmtInt(z.n_keel)}</td>
                <td className={td}>{mmText(z.mpd_mm)}</td>
                <td className={td}>{mmText(z.etd_mm)}</td>
                <td className="py-1.5 px-2 text-left">
                  <span className="inline-flex items-start gap-1.5">
                    <span className="mt-0.5 w-2.5 h-2.5 rounded-sm shrink-0 border border-border" style={{ backgroundColor: TEXTURE_CLASS_META[classifyTexture(z.etd_mm)].color }} />
                    {TEXTURE_FAA_TEXT[faaLevel(z.etd_mm)]}
                  </span>
                </td>
                <td className={td}>
                  {z.min_unit} ({mmText(z.min_unit_etd_mm)})
                </td>
                <td className={td}>{z.n_units_below_0_76}</td>
                <td className={td}>{z.n_units_at_or_above_1_14}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
