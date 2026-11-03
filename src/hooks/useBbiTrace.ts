import { loadJson } from "@/lib/skid-schema";
import { BbiTraceSchema } from "@/lib/bbi-schema";
import { useCachedLoad } from "@/hooks/useSkidData";

/** 0.25 m points of one runway (~0.6 MB), loaded after the per-unit file and cached. Pass null to skip loading. */
export function useBbiTrace(traceUrl: string | null) {
  const { data, error, loading } = useCachedLoad(traceUrl ? `bbi-trace:${traceUrl}` : null, () => loadJson(traceUrl as string, BbiTraceSchema));
  return { trace: data, loading, error };
}

export type BbiTraceState = ReturnType<typeof useBbiTrace>;
