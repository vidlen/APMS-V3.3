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
import { listBbiSurveys, SEED_BBI_SURVEY_ID } from "@/lib/bbi-surveys";
import type { RunwayId } from "@/types/skid";

const RUNWAY_IDS: RunwayId[] = ["06-24", "07L-25R"];
const RW_LABEL: Record<RunwayId, string> = { "06-24": "RWY 06/24", "07L-25R": "RWY 07L/25R" };

// Admin -> Roughness (BBI): the surveys the tab offers (the June 2026 seed plus the draft / published manifest).
// Removing a survey only drops its manifest entry from the draft; the files stay in Blob. The seed cannot be removed.
export default function BbiSurveyList() {
  const { overrides, removeBbiSurvey } = useData();
  const surveys = useMemo(() => listBbiSurveys(overrides.bbiSurveys), [overrides.bbiSurveys]);

  return (
    <div className="panel-surface rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-bold text-foreground">BBI surveys</h2>
      </div>
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-[.07em] text-muted-foreground border-b border-border text-left">
              <th className="px-3 py-2">Label</th>
              <th className="px-3 py-2">Id</th>
              <th className="px-3 py-2">Runways (survey date, lines, imported)</th>
              <th className="px-3 py-2">Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {surveys.map((s) => {
              const manifest = overrides.bbiSurveys?.[s.id];
              const isSeedId = s.id === SEED_BBI_SURVEY_ID;
              const fromAdmin = RUNWAY_IDS.some((rw) => s.runways[rw]?.source === "admin");
              return (
                <tr key={s.id} className="border-b border-border/60 align-top">
                  <td className="px-3 py-2 font-medium text-foreground">{s.label}</td>
                  <td className="px-3 py-2 font-mono">{s.id}</td>
                  <td className="px-3 py-2 space-y-0.5">
                    {RUNWAY_IDS.filter((rw) => s.runways[rw]).map((rw) => {
                      const r = s.runways[rw]!;
                      const m = manifest?.runways[rw];
                      return (
                        <div key={rw}>
                          {RW_LABEL[rw]} · {r.date} · {r.source === "admin" ? `${m?.lines.length} lines · imported ${m?.importedAt.slice(0, 10)}` : "8 lines"}
                        </div>
                      );
                    })}
                  </td>
                  <td className="px-3 py-2">{fromAdmin ? "Admin upload" : "Built-in"}</td>
                  <td className="px-3 py-2 text-right">
                    {manifest && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button className="inline-flex items-center gap-1 p-1 text-muted-foreground hover:text-destructive">
                            <Trash2 size={13} /> Remove
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{isSeedId ? "Restore the built-in data?" : `Remove survey ${s.label}?`}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {isSeedId
                                ? "The uploaded runways are removed from the draft and the survey goes back to the built-in June 2026 data."
                                : "The survey is removed from the draft. Its files stay in Blob. Visitors stop seeing it only after Publish."}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => removeBbiSurvey(s.id)}>{isSeedId ? "Restore" : "Remove"}</AlertDialogAction>
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
