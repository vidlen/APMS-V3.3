import { loadJson } from "@/lib/skid-schema";
import { BbiRunwaySchema } from "@/lib/bbi-schema";
import { SEED_SAMPLE_UNIT_SOURCES } from "@/lib/sample-units";
import type { GeoJSONFeatureCollection } from "@/lib/geojson-types";
import type { BbiSurveyView } from "@/lib/bbi-surveys";
import type { BbiRunwayData } from "@/types/bbi";
import type { RunwayId } from "@/types/skid";
import { useCachedLoad } from "@/hooks/useSkidData";

export interface BbiRunwayBundle {
  data: BbiRunwayData;
  /** Sample-unit polygons of the 2026 seed file. Only geometry and id are used: PCI payload is not read. */
  polygons: GeoJSONFeatureCollection;
}

async function loadRunway(unitsUrl: string, runway: RunwayId): Promise<BbiRunwayBundle> {
  const polygonsUrl = SEED_SAMPLE_UNIT_SOURCES["2026"][runway.replace("-", "/")];
  const [data, polygons] = await Promise.all([
    loadJson(unitsUrl, BbiRunwaySchema),
    fetch(polygonsUrl).then((res) => {
      if (!res.ok) throw new Error(`${polygonsUrl}: HTTP ${res.status}`);
      return res.json() as Promise<GeoJSONFeatureCollection>;
    }),
  ]);
  return { data, polygons };
}

/** Per-unit BBI and unit polygons of one runway of a survey, loaded once per file URL when the tab opens. */
export function useBbiData(survey: BbiSurveyView, runway: RunwayId) {
  const url = survey.runways[runway]?.unitsUrl;
  return useCachedLoad(url ? `bbi-units:${url}` : null, () => loadRunway(url as string, runway));
}
