import { useMemo } from "react";
import { useData } from "@/lib/data-store";
import { listBbiSurveys, type BbiSurveyView } from "@/lib/bbi-surveys";

/** Seed (June 2026) plus the admin-imported surveys of the draft / published manifest, newest first. */
export function useBbiSurveys(): BbiSurveyView[] {
  const { overrides } = useData();
  return useMemo(() => listBbiSurveys(overrides.bbiSurveys), [overrides.bbiSurveys]);
}
