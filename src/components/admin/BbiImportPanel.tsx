import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Play, Save, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { BBI_UNIT_COUNT } from "@/config/bbi";
import { useData } from "@/lib/data-store";
import { bbiSurvey, buildBbi, detectRole, type BbiBuild, type Issue } from "@/lib/bbi-import";
import { listBbiSurveys, SEED_BBI_SURVEY_ID } from "@/lib/bbi-surveys";
import { uploadBbiRunway, type BbiPickedFile } from "@/lib/bbi-upload";
import { sha256Hex } from "@/lib/skid-upload";
import type { RunwayId } from "@/types/skid";

const RUNWAY_IDS: RunwayId[] = ["06-24", "07L-25R"];
const RW_LABEL: Record<RunwayId, string> = { "06-24": "RWY 06/24", "07L-25R": "RWY 07L/25R" };
const SEED_LCMS = "2062903736";
const MB = 1024 * 1024;
// The points file is the largest; anything above this is refused before it is read.
const MAX_READ_BYTES = 20 * MB;
const MAX_BYTES: Record<string, number> = { units: MB, lines: MB, "unit-lines": 2 * MB, points: 20 * MB };

const cell = "px-2 py-1.5 align-top";
const field = "h-8 rounded-md border border-input bg-card px-2 text-xs text-foreground";

function IssueList({ issues, tone }: { issues: Issue[]; tone: "error" | "warn" }) {
  if (issues.length === 0) return null;
  return (
    <ul className={`text-[11px] leading-snug space-y-0.5 ${tone === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>
      {issues.map((i, k) => (
        <li key={k}>{i.message}</li>
      ))}
    </ul>
  );
}

// Admin -> Roughness (BBI): the four *_web.csv files of the BBI package in, the two JSON files the tab reads out.
// Everything is computed in the browser with the same module as the seed script (src/lib/bbi-import.ts); Save
// uploads the files to Blob and records the survey in the draft. Visitors see it only after Publish.
export default function BbiImportPanel() {
  const { overrides, upsertBbiSurveyRunway } = useData();
  const surveys = useMemo(() => listBbiSurveys(overrides.bbiSurveys), [overrides.bbiSurveys]);

  const [targetId, setTargetId] = useState(""); // "" = a new survey
  const [newId, setNewId] = useState("");
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const [lcms, setLcms] = useState("");
  const [runway, setRunway] = useState<RunwayId>("06-24");
  const [picked, setPicked] = useState<BbiPickedFile[]>([]);
  const [result, setResult] = useState<BbiBuild | null>(null);
  const [busy, setBusy] = useState<"process" | "save" | null>(null);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const existing = surveys.find((s) => s.id === targetId);
  const surveyId = targetId || newId.trim();
  const idValid = targetId !== "" || /^\d{4}-\d{2}$/.test(surveyId);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const ready = idValid && dateValid && label.trim() !== "" && picked.length > 0 && busy === null;
  const replaces = existing?.runways[runway];

  const chooseTarget = (id: string) => {
    const s = surveys.find((x) => x.id === id);
    setTargetId(id);
    setLabel(s?.label ?? "");
    setDate(s?.runways[runway]?.date ?? Object.values(s?.runways ?? {})[0]?.date ?? "");
    setLcms(id === SEED_BBI_SURVEY_ID ? SEED_LCMS : "");
    setResult(null);
  };

  const addFiles = async (list: FileList | File[]) => {
    const files = [...list].filter((f) => /\.csv$/i.test(f.name));
    if (files.length < [...list].length) toast.error("Only .csv files are accepted.");
    const next: BbiPickedFile[] = [];
    for (const file of files) {
      if (file.size > MAX_READ_BYTES) {
        toast.error(`${file.name}: larger than 20 MB.`);
        continue;
      }
      const buf = await file.arrayBuffer();
      const text = new TextDecoder().decode(buf);
      const role = detectRole(text.slice(0, text.search(/\r?\n|$/)));
      const limit = MAX_BYTES[role];
      if (limit !== undefined && file.size > limit) {
        toast.error(`${file.name}: larger than ${limit / MB} MB, the limit for the ${role} file.`);
        continue;
      }
      next.push({ file, name: file.name, text, role, sha256: await sha256Hex(buf) });
    }
    if (next.length === 0) return;
    setPicked((p) => [...p.filter((x) => !next.some((n) => n.name === x.name)), ...next]);
    setResult(null);
  };
  const remove = (name: string) => {
    setPicked((p) => p.filter((x) => x.name !== name));
    setResult(null);
  };

  const process = async () => {
    setBusy("process");
    setResult(null);
    // Let the spinner paint: the per-point CSV (86,000 rows) is parsed on the main thread, about 0.6 s.
    await new Promise((r) => setTimeout(r, 30));
    setResult(
      buildBbi(picked, {
        runway,
        nUnits: BBI_UNIT_COUNT[runway],
        survey: bbiSurvey({ id: surveyId, label: label.trim(), date, lcms: lcms.trim() }),
        sourceKind: "admin-import",
        requireCompleteTrace: true,
        sha256: Object.fromEntries(picked.map((p) => [p.name, p.sha256])),
      }),
    );
    setBusy(null);
  };

  const save = async () => {
    if (!result?.units) return;
    setBusy("save");
    try {
      const entry = await uploadBbiRunway(surveyId, result, picked);
      upsertBbiSurveyRunway(surveyId, label.trim(), runway, entry);
      toast.success("Saved to draft. Press Publish to make it visible.");
      setPicked([]);
      setResult(null);
      setTargetId("");
      setNewId("");
      setLabel("");
      setDate("");
      setLcms("");
    } catch (err) {
      console.error("BBI import save failed", err);
      const message = err instanceof Error ? err.message : "";
      toast.error(
        message.includes("presigned URL") || message.includes("Admin session")
          ? "Upload refused. Your admin session may have expired: log in again and retry."
          : `Save failed. ${message}`.trim(),
      );
    } finally {
      setBusy(null);
    }
  };

  const top10 = useMemo(
    () =>
      result?.units
        ? result.units.units
            .filter((u) => u.governing)
            .sort((a, b) => (b.governing?.bbi ?? 0) - (a.governing?.bbi ?? 0))
            .slice(0, 10)
        : [],
    [result],
  );
  const errors = result?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = result?.issues.filter((i) => i.level === "warn") ?? [];

  return (
    <div className="panel-surface rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-bold text-foreground">Import BBI CSV</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Upload the four *_web.csv files from the BBI package (petakan_bbi_0624.m + konversi_unit_web.mjs). The conversion runs in the browser; the result is kept as a draft until you press Publish.
        </p>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs space-y-1">
            <span className="block text-muted-foreground">Survey</span>
            <select className={`${field} w-[190px]`} value={targetId} onChange={(e) => chooseTarget(e.target.value)}>
              <option value="">New survey</option>
              {surveys.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id === SEED_BBI_SURVEY_ID ? `${s.label} (built-in)` : `${s.label} (${s.id})`}
                </option>
              ))}
            </select>
          </label>
          {targetId === "" && (
            <label className="text-xs space-y-1">
              <span className="block text-muted-foreground">Id (YYYY-MM)</span>
              <input
                className={`${field} w-[100px]`}
                value={newId}
                placeholder="2027-06"
                aria-invalid={newId !== "" && !idValid}
                onChange={(e) => {
                  setNewId(e.target.value);
                  setResult(null);
                }}
              />
            </label>
          )}
          <label className="text-xs space-y-1">
            <span className="block text-muted-foreground">Label</span>
            <input
              className={`${field} w-[120px]`}
              value={label}
              placeholder="Jun 2027"
              onChange={(e) => {
                setLabel(e.target.value);
                setResult(null);
              }}
            />
          </label>
          <label className="text-xs space-y-1">
            <span className="block text-muted-foreground">Survey date</span>
            <input
              type="date"
              className={`${field} w-[140px]`}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setResult(null);
              }}
            />
          </label>
          <label className="text-xs space-y-1">
            <span className="block text-muted-foreground">LCMS survey id (optional)</span>
            <input
              className={`${field} w-[140px]`}
              value={lcms}
              onChange={(e) => {
                setLcms(e.target.value);
                setResult(null);
              }}
            />
          </label>
          <label className="text-xs space-y-1">
            <span className="block text-muted-foreground">Runway</span>
            <select
              className={`${field} w-[170px]`}
              value={runway}
              onChange={(e) => {
                setRunway(e.target.value as RunwayId);
                setResult(null);
              }}
            >
              {RUNWAY_IDS.map((r) => (
                <option key={r} value={r}>
                  {RW_LABEL[r]} ({BBI_UNIT_COUNT[r]} units)
                </option>
              ))}
            </select>
          </label>
        </div>
        {newId !== "" && !idValid && <p className="text-[11px] text-destructive">The id must have the form YYYY-MM.</p>}
        {replaces && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            {RW_LABEL[runway]} already exists in survey {existing?.label} ({replaces.source === "seed" ? "built-in data" : "uploaded"}); the import will replace it in the manifest.
          </p>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void addFiles(e.dataTransfer.files);
          }}
          className={`rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground ${drag ? "border-primary bg-secondary" : "border-border"}`}
        >
          <Upload size={16} className="mx-auto mb-1.5" />
          Drag the four *_web.csv files here, or{" "}
          <button className="underline text-foreground" onClick={() => fileInput.current?.click()}>
            choose files
          </button>
          <p className="text-[11px] mt-1">Limits: 1 MB for the unit and line summaries, 2 MB for the unit-line file, 20 MB for the per-point file.</p>
          <input
            ref={fileInput}
            type="file"
            accept=".csv"
            multiple
            className="hidden"
            onChange={(e) => {
              void addFiles(e.target.files ?? []);
              e.target.value = "";
            }}
          />
        </div>

        {picked.length > 0 && (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[520px] text-xs tabular-nums">
              <thead>
                <tr className="text-[10px] uppercase tracking-[.07em] text-muted-foreground border-b border-border text-left">
                  <th className={cell}>File</th>
                  <th className={`${cell} text-right`}>Size</th>
                  <th className={cell}>Detected role</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {picked.map((p) => (
                  <tr key={p.name} className="border-b border-border/60">
                    <td className={`${cell} max-w-[320px] truncate`} title={p.name}>
                      {p.name}
                    </td>
                    <td className={`${cell} text-right whitespace-nowrap`}>{(p.file.size / 1024).toLocaleString("en-US", { maximumFractionDigits: 0 })} KB</td>
                    <td className={`${cell} ${p.role === "unknown" || p.role === "old-numbering" ? "text-destructive" : ""}`}>{p.role === "old-numbering" ? "old numbering" : p.role}</td>
                    <td className={cell}>
                      <button aria-label={`Remove ${p.name}`} className="p-1 text-muted-foreground hover:text-foreground" onClick={() => remove(p.name)}>
                        <X size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Button size="sm" onClick={() => void process()} disabled={!ready}>
          {busy === "process" ? <Spinner /> : <Play size={13} />} Process
        </Button>

        {result && (
          <div className="space-y-3 border-t border-border pt-4">
            <IssueList issues={errors} tone="error" />
            <IssueList issues={warnings} tone="warn" />

            {result.report.length > 0 && <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">{result.report.join("\n")}</pre>}

            {top10.length > 0 && (
              <div className="overflow-x-auto custom-scrollbar">
                <h3 className="panel-label mb-1">The 10 units with the highest BBI</h3>
                <table className="w-full min-w-[520px] text-xs tabular-nums">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-[.07em] text-muted-foreground border-b border-border text-left">
                      <th className={cell}>Unit</th>
                      <th className={`${cell} text-right`}>BBI</th>
                      <th className={cell}>Zone</th>
                      <th className={cell}>Line</th>
                      <th className={`${cell} text-right`}>H (cm)</th>
                      <th className={`${cell} text-right`}>L (m)</th>
                      <th className={`${cell} text-right`}>Straightedge (m)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top10.map((u) => (
                      <tr key={u.unit} className="border-b border-border/60">
                        <td className={`${cell} font-mono`}>{u.unit}</td>
                        <td className={`${cell} text-right font-mono`}>{u.governing?.bbi.toFixed(4)}</td>
                        <td className={cell}>{u.governing?.zone}</td>
                        <td className={`${cell} font-mono`}>{u.governing?.line}</td>
                        <td className={`${cell} text-right font-mono`}>{u.governing?.h_cm.toFixed(2)}</td>
                        <td className={`${cell} text-right font-mono`}>{u.governing?.bump_length_m.toFixed(2)}</td>
                        <td className={`${cell} text-right font-mono`}>{u.governing?.straightedge_m.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <Button size="sm" onClick={() => void save()} disabled={!result.units || busy !== null}>
              {busy === "save" ? <Spinner /> : <Save size={13} />} {busy === "save" ? "Saving…" : "Save to draft"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
