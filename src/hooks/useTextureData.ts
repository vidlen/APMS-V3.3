import { loadJson } from "@/lib/skid-schema";
import { TextureRunwaySchema } from "@/lib/texture-schema";
import { SEED_SAMPLE_UNIT_SOURCES } from "@/lib/sample-units";
import type { GeoJSONFeatureCollection } from "@/lib/geojson-types";
import type { TextureSurveyView } from "@/lib/texture-surveys";
import type { TextureRunwayData } from "@/types/texture";
import type { RunwayId } from "@/types/skid";
import { useCachedLoad } from "@/hooks/useSkidData";

export interface TextureRunwayBundle {
  data: TextureRunwayData;
  /** Sample-unit polygons of the 2026 seed file. Only geometry and id are used: the PCI payload is not read. */
  polygons: GeoJSONFeatureCollection;
}

async function loadRunway(url: string, runway: RunwayId): Promise<TextureRunwayBundle> {
  const polygonsUrl = SEED_SAMPLE_UNIT_SOURCES["2026"][runway.replace("-", "/")];
  const [data, polygons] = await Promise.all([
    loadJson(url, TextureRunwaySchema),
    fetch(polygonsUrl).then((res) => {
      if (!res.ok) throw new Error(`${polygonsUrl}: HTTP ${res.status}`);
      return res.json() as Promise<GeoJSONFeatureCollection>;
    }),
  ]);
  return { data, polygons };
}

/** Per-unit texture and unit polygons of one runway of a survey, loaded once per file URL when the tab opens. */
export function useTextureData(survey: TextureSurveyView, runway: RunwayId) {
  const url = survey.runways[runway]?.url;
  return useCachedLoad(url ? `texture-units:${url}` : null, () => loadRunway(url as string, runway));
}
