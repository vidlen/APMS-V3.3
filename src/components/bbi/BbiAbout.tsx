import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SEED_BBI_SURVEY_ID } from "@/lib/bbi-surveys";
import type { BbiRunwayData } from "@/types/bbi";
import { dateText, offsetText } from "./bbi-ui";

const li = "text-xs text-muted-foreground leading-relaxed";
const h = "panel-label mb-1.5";

export default function BbiAbout({ data }: { data: BbiRunwayData }) {
  const { survey, processing, lines } = data;
  const isSeed = survey.id === SEED_BBI_SURVEY_ID && data.source.kind === "seed";
  const passes = [...new Map(lines.map((l) => [l.pass, l])).values()];

  return (
    <Collapsible className="bg-card border-t border-border">
      <CollapsibleTrigger className="group w-full flex items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
        <span className="panel-label">About this data</span>
        <ChevronDown size={14} className="text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-4 pb-4 grid grid-cols-[minmax(0,1fr)] gap-5 max-w-[110ch]">
          <section>
            <h4 className={h}>Source</h4>
            <p className={li}>
              LCMS survey of {dateText(survey.date)}
              {survey.lcms_survey_id ? ` (ID ${survey.lcms_survey_id})` : ""}: {survey.device}. BBI computed in {survey.software} at {survey.output_spacing_m} m spacing, then mapped to the sample units with
              petakan_bbi_0624.m. Unit numbers are the web numbers (unit 1 at threshold 06).
            </p>
          </section>

          <section>
            <h4 className={h}>Lines processed</h4>
            <p className={li}>
              {lines.length} lines from passes {processing.passes_used.join(", ")}
              {isSeed ? " of the 22 passes" : ""}. Pass offsets from pass 1 (provisional, + = south):{" "}
              {passes.map((l) => `pass ${l.pass} ${offsetText(l.offset_m)} m (${l.direction === "E" ? "eastbound" : "westbound"})`).join(", ")}. On an eastbound pass L is the north side; on a westbound pass L is the south side.
            </p>
          </section>

          <section>
            <h4 className={h}>Removed and flagged parts</h4>
            <p className={li}>
              The last {processing.trimmed_end_m} m of each pass are removed: a smooth dip appears there only on the pass that is braking, so it is a profiler artefact, not the runway shape (AC 150/5380-9 par. 2.2g). As a result the eastbound lines have no data near
              threshold 24 and the westbound lines none near threshold 06. The first {processing.start_of_run_m} m of each pass are flagged, because the {processing.start_of_run_m} m straightedge is not yet complete there; their values are still used.
            </p>
          </section>

          <section>
            <h4 className={h}>ProFAA export corrections</h4>
            <ul className="list-disc pl-4 space-y-1">
              {processing.corrections.map((c) => (
                <li key={c} className={li}>
                  {c}
                </li>
              ))}
              <li className={li}>The BBI values themselves were checked independently from the same profile, following AC par. 2.4 (H = BBI × limit: par. 2.4b): point-by-point correlation 1.000.</li>
            </ul>
          </section>

          <section>
            <h4 className={h}>Still to be confirmed with the surveyor</h4>
            <ul className="list-disc pl-4 space-y-1">
              {processing.caveats.map((c) => (
                <li key={c} className={li}>
                  {c}
                </li>
              ))}
              <li className={li}>RWY 07L/25R has no BBI yet: its ERD profile was exported at 1 m spacing, while BBI needs the 0.25 m profile.</li>
            </ul>
          </section>

          <section>
            <h4 className={h}>Standing of this data</h4>
            <p className={li}>
              Functional condition data, <strong className="text-foreground">not used in the risk scores</strong>. The limit of 1.0 is the Acceptable limit of {data.thresholds.ref}; profile locations follow AC par. 2.2f. The g_flag field (BBI above 1.0) is stored for the G axis of the SKG scheme.
            </p>
          </section>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
