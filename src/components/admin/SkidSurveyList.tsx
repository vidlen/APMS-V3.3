import { useMemo } from "react";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useData } from "@/lib/data-store";
import { listSkidSurveys, SEED_SKID_SURVEY_ID } from "@/lib/skid-surveys";
import type { RunwayId } from "@/types/skid";

const RUNWAY_IDS: RunwayId[] = ["06-24", "07L-25R"];
const RW_LABEL: Record<RunwayId, string> = { "06-24": "RWY 06/24", "07L-25R": "RWY 07L/25R" };

// Admin -> Skid Resistance: the surveys the Skid tab offers (the June 2026 seed plus the draft / published manifest).
// Removing a survey only drops its manifest entry from the draft; the files stay in Blob.
export default function SkidSurveyList() {
  const { overrides, removeSkidSurvey } = useData();
  const surveys = useMemo(() => listSkidSurveys(overrides.skidSurveys), [overrides.skidSurveys]);

  return (
    <div className="panel-surface rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-bold text-foreground">Skid resistance surveys</h2>
      </div>
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-[.07em] text-muted-foreground border-b border-border text-left">
              <th className="px-3 py-2">Label</th>
              <th className="px-3 py-2">Id</th>
              <th className="px-3 py-2">Runways (WIB date, measured lanes)</th>
              <th className="px-3 py-2">Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {surveys.map((s) => {
              const inManifest = overrides.skidSurveys?.[s.id] !== undefined;
              const isSeedId = s.id === SEED_SKID_SURVEY_ID;
              const manifest = overrides.skidSurveys?.[s.id];
              const fromAdmin = RUNWAY_IDS.some((rw) => s.runways[rw]?.source === "admin");
              return (
                <tr key={s.id} className="border-b border-border/60 align-top">
                  <td className="px-3 py-2 font-medium text-foreground">{s.label}</td>
                  <td className="px-3 py-2 font-mono">{s.id}</td>
                  <td className="px-3 py-2 space-y-0.5">
                    {RUNWAY_IDS.filter((rw) => s.runways[rw]).map((rw) => {
                      const r = s.runways[rw]!;
                      const lanes = r.source === "admin" ? manifest?.runways[rw]?.lanes.length : 8;
                      return (
                        <div key={rw}>
                          {RW_LABEL[rw]} · {r.startWib.slice(0, 10)} · {lanes} lanes
                        </div>
                      );
                    })}
                  </td>
                  <td className="px-3 py-2">{fromAdmin ? "Admin upload" : "Built-in"}</td>
                  <td className="px-3 py-2 text-right">
                    {inManifest && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button className="p-1 text-muted-foreground hover:text-destructive" aria-label={`${isSeedId ? "Restore" : "Delete"} survey ${s.label}`}>
                            <Trash2 size={14} />
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{isSeedId ? "Restore the built-in data?" : `Delete survey ${s.label}?`}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {isSeedId
                                ? "The uploaded runways are removed from the draft and the survey goes back to the built-in June 2026 data."
                                : "The survey is removed from the draft. Its files stay in Blob. Visitors stop seeing it only after Publish."}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => removeSkidSurvey(s.id)}>{isSeedId ? "Restore" : "Delete"}</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
