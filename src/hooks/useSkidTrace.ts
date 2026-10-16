import { useMemo } from "react";
import { loadJson, SkidTraceSchema } from "@/lib/skid-schema";
import { movingAverage } from "@/lib/skid-trace";
import { useCachedLoad } from "@/hooks/useSkidData";
import type { LaneCode, RunwayId } from "@/types/skid";

/** Per-meter readings of one runway (~300 KB), loaded lazily and cached. Pass null to skip loading.
 *  `ma` is the 152 m moving average of every lane, computed once per file. */
export function useSkidTrace(runway: RunwayId | null) {
  const { data, error, loading } = useCachedLoad(runway ? `skid-trace-${runway}` : null, () =>
    loadJson(`/data/skid-${runway}-2026-1m.json`, SkidTraceSchema),
  );
  const ma = useMemo(
    () => (data ? new Map<LaneCode, (number | null)[]>(data.lanes.map((l) => [l.lane, movingAverage(l.mu).mean])) : null),
    [data],
  );
  return { trace: data, ma, loading, error };
}

export type SkidTraceState = ReturnType<typeof useSkidTrace>;
