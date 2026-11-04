import { useMemo } from "react";
import { useData } from "@/lib/data-store";
import { listTextureSurveys, type TextureSurveyView } from "@/lib/texture-surveys";

/** Seed (June 2026) plus the admin-imported surveys of the draft / published manifest, newest first. */
export function useTextureSurveys(): TextureSurveyView[] {
  const { overrides } = useData();
  return useMemo(() => listTextureSurveys(overrides.textureSurveys), [overrides.textureSurveys]);
}
