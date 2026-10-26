import { useMemo } from "react";
import { useData } from "@/lib/data-store";
import { listSkidSurveys, type SkidSurveyView } from "@/lib/skid-surveys";

/** Seed (June 2026) plus the admin-imported surveys of the draft / published manifest, newest first. */
export function useSkidSurveys(): SkidSurveyView[] {
  const { overrides } = useData();
  return useMemo(() => listSkidSurveys(overrides.skidSurveys), [overrides.skidSurveys]);
}
