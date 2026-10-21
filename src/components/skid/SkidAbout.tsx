import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SKID_THRESHOLDS, SKID_THRESHOLDS_95KMH } from "@/config/skid";
import { useSkidTrace } from "@/hooks/useSkidTrace";
import type { RunwayId, SkidRunwayData } from "@/types/skid";
import { RUNWAYS, fmtInt, surveyWindow } from "./skid-ui";

// FAA AC 150/5320-12C paragraphs this tab relies on (page = AC page, PDF page in brackets).
const FAA_REFS: [string, string, string][] = [
  ["Par. 3-15", "At 40 mph (65 km/h) recording starts 500 ft (152 m) from the threshold and stops about 500 ft before the other end. For runways serving narrow- and wide-body aircraft, survey 10 and 20 ft (3 and 6 m) right of the centre line.", "21 (27)"],
  ["Par. 3-16", "A full survey uses both speeds: low speed reflects macrotexture, contaminants and drainage; high speed reflects microtexture.", "21 (27)"],
  ["Par. 3-17", "The wetting system puts 1 mm of water in front of the measuring wheel.", "21 (27)"],
  ["Par. 3-19, Table 3-2", "Airport Equipment Co. Skiddometer thresholds: 40 mph 0.50 / 0.60 / 0.82; 60 mph 0.34 / 0.47 / 0.74.", "22 (28)"],
  ["Par. 3-20.a–d", "Assessment from 500 ft segment averages (immediate, extensive, monitor flags).", "22–23 (28–29)"],
  ["Par. 3-21", "Evaluate the data with a computer program.", "23 (29)"],
  ["Par. 3-22, 3-23", "Measure texture depth when the 3-20 criteria are not met; touchdown, midpoint and rollout zones.", "23 (29)"],
  ["App. 3 par. 1.a(3)", "The device gives averages per 500 ft (150 m) and per third of the runway length.", "App. 3 p. 1 (41)"],
  ["App. 3 par. 1.a(4)", "Friction trace against pavement length, scale at least 1 inch = 300 ft.", "App. 3 p. 1 (41)"],
  ["App. 3 par. 1.a(5)", "Each 500 ft segment average repeats within ±0.06 (95.5% confidence).", "App. 3 p. 1 (41)"],
  ["App. 3 par. 1.a(7), 1.b(1)", "Test speeds 40 and 60 mph with ±3 mph (±5 km/h) tolerance.", "App. 3 p. 1 (41)"],
  ["App. 3 par. 1.a(9)", "Printout: runway and date, survey time, continuous friction trace, a mark every 100 ft (30 m), 500 ft and third averages, segment mean speed.", "App. 3 p. 1 (41)"],
  ["App. 4", "FAA-approved device list; the 1997 edition lists the AEC BV-11 Skiddometer.", "App. 4 p. 1 (43)"],
];

const li = "text-xs text-muted-foreground leading-relaxed";
const h = "panel-label mb-1.5";

export default function SkidAbout({ data }: { data: Record<RunwayId, SkidRunwayData> }) {
  const a = useSkidTrace("06-24");
  const b = useSkidTrace("07L-25R");
  const recon = { "06-24": a.trace?.reconciliation, "07L-25R": b.trace?.reconciliation } as const;

  return (
    <Collapsible className="bg-card border-t border-border">
      <CollapsibleTrigger className="group w-full flex items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
        <span className="panel-label">About this data</span>
        <ChevronDown size={14} className="text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>

      <CollapsibleContent>
        {/* minmax(0,1fr): a wide table inside scrolls in its own wrapper instead of stretching the column past a phone screen. */}
        <div className="px-4 pb-4 grid grid-cols-[minmax(0,1fr)] gap-5 max-w-[110ch]">
          <section>
            <h4 className={h}>Survey</h4>
            <ul className="space-y-1">
              {RUNWAYS.map((r) => {
                const s = data[r.id].survey;
                return (
                  <li key={r.id} className={li}>
                    <span className="text-foreground font-medium">{r.label}</span>: {s.device} (BV-11), {s.speed_kmh} km/h, wet (self-wetting, 1 mm), test
                    direction {s.direction}, {surveyWindow(s)}, {fmtInt(s.measured_length_m)} m recorded per lane.
                  </li>
                );
              })}
              <li className={li}>
                Data cover June 2026 only and a single speed (65 km/h). This tab is a comparator: it is <strong className="text-foreground">not used in the risk scores</strong>{" "}
                (Likelihood, Frequency or Consequence).
              </li>
            </ul>
          </section>

          <section>
            <h4 className={h}>How the numbers are made</h4>
            <p className={li}>
              Source: 16 Moventor CSV files (8 lanes × 2 runways), 1 m resolution. Each reading is placed along the axis of the sample-unit polygons with station = s0 −
              DISTANCE, stations measured from threshold 24 / 25R (the test runs from unit 1 at 06 / 07L toward the last unit); s0 is the median GPS projection of that lane
              (the 6.0 m lanes of RWY 06/24 have no GPS and use the median of the other lanes). Each unit covers the stations from its own start up to the start of the
              unit before it, since stations fall as unit numbers rise. Per unit, μ 10 m is the mean of the readings inside the unit, μ 152 m is the mean over the
              152.4 m window centred on the unit (the way FAA assesses), and the governing value is the lowest lane. All unit figures were checked against a live-formula
              workbook.
            </p>
          </section>

          <section>
            <h4 className={h}>Per-meter data and reconciliation</h4>
            <p className={li}>
              The profile, per-meter heatmap, per-meter map lanes and the readings grid use every 1 m reading as recorded. A converter recomputes n, μ 10 m and μ 152 m for
              every unit-lane pair from those readings and compares them with the per-unit files:{" "}
              {RUNWAYS.map((r, i) => {
                const rc = recon[r.id];
                return (
                  <span key={r.id}>
                    {i > 0 && "; "}
                    {rc ? `${fmtInt(rc.n_ok)} of ${fmtInt(rc.unit_lane_pairs)} pairs match on ${r.label}` : `${r.label}: loading`}
                  </span>
                );
              })}
              {" "}(largest difference 0.00005, the 4-decimal rounding limit).
            </p>
          </section>

          <section>
            <h4 className={h}>Thresholds</h4>
            <p className={li}>
              FAA AC 150/5320-12C Table 3-2, Skiddometer at 40 mph (65 km/h): minimum {SKID_THRESHOLDS.minimum.toFixed(2)}, maintenance planning{" "}
              {SKID_THRESHOLDS.maintenancePlanning.toFixed(2)}, new design {SKID_THRESHOLDS.newDesign.toFixed(2)}. The 60 mph (95 km/h) values (
              {SKID_THRESHOLDS_95KMH.minimum} / {SKID_THRESHOLDS_95KMH.maintenancePlanning} / {SKID_THRESHOLDS_95KMH.newDesign}) are not used: this survey has no 95 km/h data.
              Assessment follows par. 3-20 on 500 ft (152.4 m) segment averages; the FAA 3-20 flags here are an aid for interpretation, not an official assessment.
              Whether the Moventor BV-11 should use the Skiddometer row or manufacturer-supplied thresholds (Change 9 note) is still to be confirmed.
            </p>
          </section>

          <section>
            <h4 className={h}>Limits and notes</h4>
            <ul className="list-disc pl-4 space-y-1">
              <li className={li}>Only 65 km/h was surveyed (FAA par. 3-16 asks for 65 and 95 km/h), so microtexture is not described.</li>
              <li className={li}>
                About 300 m at each runway end was not recorded. FAA par. 3-15 starts recording 152 m from the threshold, so roughly 150 m at each end that should have been
                surveyed has no data.
              </li>
              <li className={li}>Position is uncertain by about ±1 unit: lane start points differ by 6–11 m. Lane lines on the map use the nominal offset from the file name; GPS lateral position is only reported, because the antenna is not at the measuring wheel.</li>
              <li className={li}>
                18–22% of the 1 m rows in each run repeat the previous reading (device sampling). They are kept, so n = 10 is not 10 independent samples.
              </li>
              <li className={li}>
                Run mean speeds are 64.6–67.1 km/h, inside the ±5 km/h tolerance. A few readings on RWY 07L/25R fall outside 60–70 km/h (see the run list).
              </li>
              <li className={li}>Values within ±0.06 of a threshold are within device repeatability (App. 3 par. 1.a(5)) and are not clearly above or below it.</li>
              <li className={li}>
                The third-based and segment figures use fixed 152.4 m steps from the start of recording, as on the device printout; the last segment is partial.
              </li>
            </ul>
          </section>

          <section>
            <h4 className={h}>FAA references (AC 150/5320-12C, 18 Mar 1997)</h4>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[620px] text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[.07em] text-muted-foreground border-b border-border">
                    <th className="text-left font-medium py-1.5 pr-3 whitespace-nowrap">Reference</th>
                    <th className="text-left font-medium pr-3">What is used</th>
                    <th className="text-left font-medium whitespace-nowrap">Page</th>
                  </tr>
                </thead>
                <tbody>
                  {FAA_REFS.map(([ref, what, page]) => (
                    <tr key={ref} className="hairline-row align-top">
                      <td className="py-1.5 pr-3 font-mono whitespace-nowrap text-foreground">{ref}</td>
                      <td className="pr-3 text-muted-foreground">{what}</td>
                      <td className="text-muted-foreground whitespace-nowrap">{page}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={`${li} mt-2`}>
              AC 150/5320-12C (1997) is still the current version; Change 9 (29 May 2025) updated the list of approved devices and now lists the Moventor Oy Skiddometer
              BV11.
            </p>
          </section>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
