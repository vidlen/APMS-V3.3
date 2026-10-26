import { useMemo } from "react";
import { loadJson, SkidTraceSchema } from "@/lib/skid-schema";
import { movingAverage } from "@/lib/skid-trace";
import { useCachedLoad } from "@/hooks/useSkidData";
import type { SkidSurveyView } from "@/lib/skid-surveys";
import type { LaneCode, RunwayId } from "@/types/skid";

/** Per-meter readings of one runway of a survey (~300 KB), loaded lazily and cached. Pass null (or a survey
 *  without that runway) to skip loading. `ma` is the 152 m moving average of every lane, computed once per file. */
export function useSkidTrace(survey: SkidSurveyView | null, runway: RunwayId | null) {
  const url = survey && runway ? survey.runways[runway]?.traceUrl : undefined;
  const { data, error, loading } = useCachedLoad(url ? `skid-trace:${survey?.id}:${runway}:${url}` : null, () =>
    loadJson(url as string, SkidTraceSchema),
  );
  const ma = useMemo(
    () => (data ? new Map<LaneCode, (number | null)[]>(data.lanes.map((l) => [l.lane, movingAverage(l.mu).mean])) : null),
    [data],
  );
  return { trace: data, ma, loading, error };
}

export type SkidTraceState = ReturnType<typeof useSkidTrace>;
