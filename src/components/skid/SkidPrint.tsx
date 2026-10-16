import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { classifySkid, SKID_CLASS_META } from "@/config/skid";
import type { SkidTraceState } from "@/hooks/useSkidTrace";
import { fixedSegments, laneKey, profileRows, thirds as thirdsOf } from "@/lib/skid-trace";
import type { SkidLaneTrace, SkidRunwayTrace } from "@/types/skid";
import SkidProfileChart from "./SkidProfileChart";
import SkidSpeedStrip from "./SkidSpeedStrip";
import { DEFAULT_OVERLAYS, fmtInt, laneHeaderLines, muText, Y_AXIS_WIDTH, type RunwayMeta } from "./skid-ui";

const PAGE_W = 1000; // plot width in CSS px; A4 landscape with 10 mm margins is ~1047 px wide
const noop = () => undefined;

// Printed only (display: none on screen). Rules: the app shell (#root) is hidden, each lane is one
// A4 landscape page, and fills are forced to print.
const CSS = `
  @page { size: A4 landscape; margin: 10mm; }
  @media screen { .skid-print-root { display: none; } }
  @media print {
    html, body { height: auto !important; width: auto !important; overflow: visible !important; background: #fff !important; }
    #root { display: none !important; }
    .skid-print-root { display: block; color: #1f1f1f; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .skid-print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .skid-print-page { break-after: page; page-break-after: always; }
    .skid-print-page:last-child { break-after: auto; page-break-after: auto; }
  }
  .skid-print-table { border-collapse: collapse; width: 100%; font-size: 9px; margin-top: 8px; }
  .skid-print-table th, .skid-print-table td { border: 1px solid #c9c8c0; padding: 2px 3px; text-align: center; }
  .skid-print-table th:first-child, .skid-print-table td:first-child { text-align: left; white-space: nowrap; }
`;

function PrintPage({ rt, runway, lane, ma }: { rt: SkidRunwayTrace; runway: RunwayMeta; lane: SkidLaneTrace; ma: NonNullable<SkidTraceState["ma"]> }) {
  const domain: [number, number] = [0, rt.unit_bounds.last_end_m];
  const rows = useMemo(
    () => profileRows(rt, [lane], domain, Math.ceil(domain[1] - domain[0]), ma), // 1 m rows: one point per metre
    // domain is rebuilt each render; it only depends on rt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rt, lane, ma],
  );
  const segments = useMemo(() => fixedSegments(lane), [lane]);
  const thirds = useMemo(() => thirdsOf(lane), [lane]);
  const [title, sub] = laneHeaderLines(rt, runway, lane);
  const cell = (mean: number | null) => {
    const m = SKID_CLASS_META[classifySkid(mean)];
    return { backgroundColor: m.color, color: m.text };
  };

  return (
    <section className="skid-print-page">
      <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{title}</p>
      <p style={{ fontSize: 12, color: "#555", margin: "2px 0 6px" }}>{sub}</p>
      <SkidProfileChart
        rt={rt}
        lanes={[lane]}
        mode="one"
        runway={runway}
        rows={rows}
        width={PAGE_W}
        height={340}
        domain={domain}
        overlays={DEFAULT_OVERLAYS}
        selectedUnit={null}
        thirds={thirds}
        onZoom={noop}
        onSelectUnit={noop}
      />
      <p style={{ fontSize: 10, color: "#555", margin: "2px 0 0", paddingLeft: Y_AXIS_WIDTH }}>
        Speed (km/h) · grey band = 65 ± 5 · outside the band: {lane.stats.rows_outside_speed_tol} m
      </p>
      <SkidSpeedStrip rows={rows} laneKey={laneKey(lane.lane)} width={PAGE_W} domain={domain} />

      {/* 500 ft averages and third averages with their mean speeds, as on the device printout (App. 3 par. 1.a(3), 1.a(9)). */}
      <table className="skid-print-table">
        <thead>
          <tr>
            <th>152.4 m (500 ft) segment</th>
            {segments.map((s, i) => (
              <th key={i}>
                {i + 1}
                {s.partial ? "*" : ""}
              </th>
            ))}
            <th>Whole run</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>DISTANCE to (m)</td>
            {segments.map((s, i) => (
              <td key={i}>{fmtInt(s.dTo)}</td>
            ))}
            <td>{fmtInt(lane.length_m)}</td>
          </tr>
          <tr>
            <td>μ avg</td>
            {segments.map((s, i) => (
              <td key={i} style={cell(s.mean)}>
                {muText(s.mean)}
              </td>
            ))}
            <td style={cell(lane.stats.mean_mu)}>{muText(lane.stats.mean_mu)}</td>
          </tr>
          <tr>
            <td>Speed avg (km/h)</td>
            {segments.map((s, i) => (
              <td key={i}>{s.meanSpeed?.toFixed(1) ?? "—"}</td>
            ))}
            <td>{lane.stats.mean_speed_kmh?.toFixed(1) ?? "—"}</td>
          </tr>
        </tbody>
      </table>
      <p style={{ fontSize: 10, margin: "6px 0 0" }}>
        Thirds of the recording ({runway.testEnd} end → {runway.farEnd} end):{" "}
        {thirds.map((t) => `${muText(t.mean)} at ${t.meanSpeed?.toFixed(1) ?? "—"} km/h`).join(" · ")}. * = last segment shorter than 152.4 m.
      </p>
      <p style={{ fontSize: 9, color: "#666", margin: "4px 0 0" }}>
        Thresholds (FAA AC 150/5320-12C Table 3-2, Skiddometer, 65 km/h): minimum 0.50, maintenance planning 0.60, new design 0.82. Segment averages repeat within ±0.06 (App. 3
        par. 1.a(5)). Comparator data, not used in the risk scores.
      </p>
    </section>
  );
}

// One A4 landscape page per lane of the runway on screen. Mounted only while printing: it opens the
// browser's print dialog once the charts are painted and unmounts when the dialog closes.
export default function SkidPrint({ runway, traceState, onDone }: { runway: RunwayMeta; traceState: SkidTraceState; onDone: () => void }) {
  const { trace: rt, ma } = traceState;

  useEffect(() => {
    if (!rt || !ma) return;
    window.addEventListener("afterprint", onDone, { once: true });
    // Two frames so the charts are on the page before the dialog snapshots it.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("afterprint", onDone);
    };
  }, [rt, ma, onDone]);

  if (!rt || !ma) return null;
  return createPortal(
    <div className="skid-print-root">
      <style>{CSS}</style>
      {rt.lanes.map((lane) => (
        <PrintPage key={lane.lane} rt={rt} runway={runway} lane={lane} ma={ma} />
      ))}
    </div>,
    document.body,
  );
}
