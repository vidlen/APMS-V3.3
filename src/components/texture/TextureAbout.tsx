import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { TextureRunwayData } from "@/types/texture";
import { dateText } from "./texture-ui";

const li = "text-xs text-muted-foreground leading-relaxed";
const h = "panel-label mb-1.5";

export default function TextureAbout({ data }: { data: TextureRunwayData }) {
  const { survey, keel, processing } = data;
  const isSeed = data.source.kind === "seed";

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
              {isSeed ? (
                <>LCMS surveys of 28 June 2026 for RWY 06/24 (ID 2062903736, "RUNWAY 2406 PCI") and 18 June 2026 for RWY 07L/25R (ID 2061902896, "Runway Utara 18 Juni 2026").</>
              ) : (
                <>
                  LCMS survey of {dateText(survey.date)}
                  {survey.lcms_survey_id ? ` (ID ${survey.lcms_survey_id})` : ""}.
                </>
              )}{" "}
              MPD per 10 m segment in 5 transverse bands across the ±4 m scan width, computed by the LCMS software (ASTM E1845 §7.1–7.6 procedure, according to the package README).
            </p>
          </section>

          <section>
            <h4 className={h}>Processing</h4>
            <p className={li}>
              Package {survey.package}: MPD ≤ 0 is a dropout; turn-around rows are removed; a band's position is the midpoint of its band polygon; the axis is the centreline of the sample-unit polygons; the keel is the valid band values with |offset| ≤ {keel.half_width_m} m.
            </p>
          </section>

          {isSeed && (
            <section>
              <h4 className={h}>Position of the axis</h4>
              <p className={li}>
                The middle of the LCMS scan envelope lies +0.83 m (RWY 06/24) and +0.31 m (RWY 07L/25R) from the polygon axis; the centre of pass 1 lies +1.10 m and −0.83 m from it. Moving the axis by ±1 m changes the keel MPD per zone by at most 0.033 mm.
              </p>
            </section>
          )}

          <section>
            <h4 className={h}>ETD</h4>
            <p className={li}>ETD = {data.etd.a} + {data.etd.b} × MPD ({data.etd.ref}). The FAA levels are stated in volumetric texture depth, so ETD is used as the estimate of texture depth. This assumption is explicit.</p>
          </section>

          <section>
            <h4 className={h}>FAA levels</h4>
            <p className={li}>AC 150/5320-12C par. 3-23b judges the average per runway zone (touchdown, midpoint, rollout). The runway is used in both directions, so the zones here are thirds by position. The AC states no action for the 0.25–0.40 mm range.</p>
          </section>

          <section>
            <h4 className={h}>Keel width</h4>
            <p className={li}>
              The keel width of ±{keel.half_width_m} m is a research decision.
              {isSeed && " On RWY 06/24 the high texture spreads to about +11 m on the south side (see the cross-section)."}
            </p>
          </section>

          <section>
            <h4 className={h}>Values above 2 mm</h4>
            <p className={li}>These values are not removed. Their LCMS image names are in the unit panel for checking (raveling, patches, lights or markings).</p>
          </section>

          <section>
            <h4 className={h}>SD</h4>
            <p className={li}>SD is the spread between band values within a 10 m unit, not the SD of 100 mm segments of E1845 §8.1.13, because the 100 mm data is not in the CSV.</p>
          </section>

          <section>
            <h4 className={h}>Still to be confirmed with the surveyor</h4>
            <ul className="list-disc pl-4 space-y-1">
              {processing.caveats.map((c) => (
                <li key={c} className={li}>
                  {c}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h4 className={h}>Standing of this data</h4>
            <p className={li}>
              Functional condition data, <strong className="text-foreground">not used in the risk scores</strong>. The k_flags field is stored for the K axis of the SKG scheme.
            </p>
          </section>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
