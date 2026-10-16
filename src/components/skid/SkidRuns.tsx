import { LANE_ORDER } from "@/config/skid";
import { useSkidTrace } from "@/hooks/useSkidTrace";
import type { RunwayId, SkidRunwayData } from "@/types/skid";
import { RUNWAYS, fmtInt, muText, wibClock } from "./skid-ui";

// Every measurement run that went into the app: 8 lanes × 2 runways.
// Offsets, GPS flags and file names come from the per-unit files; lengths,
// means and speed/repeat counts from the per-meter files.
export default function SkidRuns({ data }: { data: Record<RunwayId, SkidRunwayData> }) {
  const a = useSkidTrace("06-24");
  const b = useSkidTrace("07L-25R");
  const traces = { "06-24": a.trace, "07L-25R": b.trace } as const;
  const error = a.error ?? b.error;
  const ready = a.trace && b.trace;

  return (
    <div className="px-4 py-3 bg-card border-t border-border">
      <h3 className="panel-label mb-2">Measurement runs (16) — 8 lanes × 2 runways, 65 km/h, wet</h3>

      {error ? (
        <p className="py-4 text-sm text-muted-foreground break-words">Failed to load per-meter data: {error}</p>
      ) : !ready ? (
        <p className="py-4 text-sm text-muted-foreground">Loading run statistics...</p>
      ) : (
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-[980px] text-xs tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-[.07em] text-muted-foreground border-b border-border">
                <th className="text-left font-medium py-1.5 pr-2">Runway</th>
                <th className="text-left font-medium px-2">Lane</th>
                <th className="text-right font-medium px-2">Offset (m)</th>
                <th className="text-right font-medium px-2">Start (WIB)</th>
                <th className="text-right font-medium px-2">Recorded (m)</th>
                <th className="text-right font-medium px-2">Mean μ</th>
                <th className="text-right font-medium px-2">Mean speed (km/h)</th>
                <th className="text-right font-medium px-2">Outside 65 ± 5 km/h (m)</th>
                <th className="text-right font-medium px-2">Repeated rows (%)</th>
                <th className="text-center font-medium px-2">GPS</th>
                <th className="text-left font-medium px-2">File</th>
              </tr>
            </thead>
            <tbody>
              {RUNWAYS.flatMap((rw) =>
                LANE_ORDER.map((code, idx) => {
                  const meta = data[rw.id].lanes.find((l) => l.code === code)!;
                  const t = traces[rw.id]!.lanes.find((l) => l.lane === code)!;
                  return (
                    <tr key={`${rw.id}-${code}`} className={`hairline-row ${idx === 0 ? "border-t border-border" : ""}`}>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{idx === 0 ? rw.label : ""}</td>
                      <td className="px-2 font-mono">{code}</td>
                      <td className="text-right px-2 font-mono">{meta.offset_m.toFixed(1)}</td>
                      <td className="text-right px-2 font-mono whitespace-nowrap">{wibClock(meta.record_start_utc)}</td>
                      <td className="text-right px-2 font-mono">{fmtInt(t.length_m)}</td>
                      <td className="text-right px-2 font-mono text-foreground">{muText(t.stats.mean_mu)}</td>
                      <td className="text-right px-2 font-mono">{t.stats.mean_speed_kmh?.toFixed(1) ?? "—"}</td>
                      <td className="text-right px-2 font-mono">{t.stats.rows_outside_speed_tol}</td>
                      <td className="text-right px-2 font-mono">{((t.stats.held_rows / t.stats.rows) * 100).toFixed(1)}</td>
                      <td className="text-center px-2">{meta.gps ? "yes" : "no"}</td>
                      <td className="px-2 text-muted-foreground max-w-[260px] truncate" title={meta.file}>
                        {meta.file}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground mt-2 max-w-[90ch]">
        Repeated rows are 1 m rows whose friction and speed equal the previous row (the device samples slightly less often than every metre and fills the gap);
        they are kept, as in the unit averages.
      </p>
    </div>
  );
}
