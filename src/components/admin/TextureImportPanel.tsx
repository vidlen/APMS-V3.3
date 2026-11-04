import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Play, Save, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import TextureZoneTable from "@/components/texture/TextureZoneTable";
import { TEXTURE_UNIT_COUNT } from "@/config/texture";
import { useData } from "@/lib/data-store";
import { sha256Hex } from "@/lib/skid-upload";
import { buildTexture, detectRole, detectRunway, textureSurvey, type Issue, type TextureBuild } from "@/lib/texture-import";
import { listTextureSurveys, SEED_TEXTURE_SURVEY_ID } from "@/lib/texture-surveys";
import { uploadTextureRunway, type TexturePickedFile } from "@/lib/texture-upload";
import type { RunwayId } from "@/types/skid";

const RUNWAY_IDS: RunwayId[] = ["06-24", "07L-25R"];
const RW_LABEL: Record<RunwayId, string> = { "06-24": "RWY 06/24", "07L-25R": "RWY 07L/25R" };
const MB = 1024 * 1024;
const MAX_BANDS_BYTES = 10 * MB;
const MAX_OTHER_BYTES = MB;
/** Enough for the header line of any CSV of the package or of a raw LCMS export. */
const HEAD_BYTES = 64 * 1024;
const LOWEST_SHOWN = 10;

const cell = "px-2 py-1.5 align-top";
const cellRight = "px-2 py-1.5 align-top text-right";
const field = "h-8 rounded-md border border-input bg-card px-2 text-xs text-foreground";
const ROLE_TEXT: Record<TexturePickedFile["role"], string> = {
  bands: "bands",
  "units-check": "units check",
  passes: "passes",
  "photo-check": "photo check",
  unknown: "unknown",
  "raw-lcms": "raw LCMS export",
};

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

// Admin -> Macrotexture: the CSVs of the TEKSTUR_2026 package in, the JSON file the tab reads out. Everything is
// computed in the browser with the same module as the seed script (src/lib/texture-import.ts); Save uploads to Blob
// and records the survey in the draft. Visitors see it only after Publish.
export default function TextureImportPanel() {
  const { overrides, upsertTextureSurveyRunway } = useData();
  const surveys = useMemo(() => listTextureSurveys(overrides.textureSurveys), [overrides.textureSurveys]);

  const [targetId, setTargetId] = useState(""); // "" = a new survey
  const [newId, setNewId] = useState("");
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const [lcmsTyped, setLcmsTyped] = useState("");
  const [runway, setRunway] = useState<RunwayId>("06-24");
  const [picked, setPicked] = useState<TexturePickedFile[]>([]);
  const [result, setResult] = useState<TextureBuild | null>(null);
  const [busy, setBusy] = useState<"process" | "save" | null>(null);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const existing = surveys.find((s) => s.id === targetId);
  const surveyId = targetId || newId.trim();
  const idValid = targetId !== "" || /^\d{4}-\d{2}$/.test(surveyId);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const ready = idValid && dateValid && label.trim() !== "" && picked.length > 0 && busy === null;
  const replaces = existing?.runways[runway];
  // Filled in from the gambar column after Process, unless the admin typed an id. Typing drops the result (see below).
  const lcms = lcmsTyped || (result?.data?.survey.lcms_survey_id ?? "");

  const chooseTarget = (id: string) => {
    const s = surveys.find((x) => x.id === id);
    setTargetId(id);
    setLabel(s?.label ?? "");
    setDate(s?.runways[runway]?.date ?? Object.values(s?.runways ?? {})[0]?.date ?? "");
    setLcmsTyped("");
    setResult(null);
  };

  const addFiles = async (list: FileList | File[]) => {
    const all = [...list];
    const notNeeded = all.filter((f) => /^log_.*\.txt$/i.test(f.name) || /\.png$/i.test(f.name));
    if (notNeeded.length > 0) toast.info(`Not needed: ${notNeeded.map((f) => f.name).join(", ")}`);
    const files = all.filter((f) => /\.csv$/i.test(f.name));
    if (files.length + notNeeded.length < all.length) toast.error("Only .csv files are accepted.");
    const next: TexturePickedFile[] = [];
    for (const file of files) {
      const head = (await file.slice(0, HEAD_BYTES).text()).split(/\r?\n/)[0];
      const role = detectRole(head);
      const runwayOf = detectRunway(head);
      // A file that is not from the package is only ever refused, so its header is all that is read.
      if (role === "raw-lcms" || role === "unknown") {
        next.push({ file, name: file.name, text: head, sha256: "", role, runway: runwayOf });
        continue;
      }
      const limit = role === "bands" ? MAX_BANDS_BYTES : MAX_OTHER_BYTES;
      if (file.size > limit) {
        toast.error(`${file.name}: larger than ${limit / MB} MB, the limit for the ${ROLE_TEXT[role]} file.`);
        continue;
      }
      const buf = await file.arrayBuffer();
      next.push({ file, name: file.name, text: new TextDecoder().decode(buf), role, runway: runwayOf, sha256: await sha256Hex(buf) });
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
    // Let the spinner paint: the per-band CSV (about 37,000 rows) is parsed on the main thread, about 0.4 s.
    await new Promise((r) => setTimeout(r, 30));
    setResult(
      buildTexture(picked, {
        runway,
        nUnits: TEXTURE_UNIT_COUNT[runway],
        survey: textureSurvey({ id: surveyId, label: label.trim(), date, lcms: lcmsTyped.trim() }),
        sourceKind: "admin-import",
        requireComplete: true,
        sha256: Object.fromEntries(picked.map((p) => [p.name, p.sha256])),
      }),
    );
    setBusy(null);
  };

  const save = async () => {
    if (!result?.data) return;
    setBusy("save");
    try {
      const entry = await uploadTextureRunway(surveyId, result, picked);
      upsertTextureSurveyRunway(surveyId, label.trim(), runway, entry);
      toast.success("Saved to draft. Press Publish to make it visible.");
      setPicked([]);
      setResult(null);
      setTargetId("");
      setNewId("");
      setLabel("");
      setDate("");
      setLcmsTyped("");
    } catch (err) {
      console.error("Texture import save failed", err);
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

  const lowest = useMemo(
    () =>
      result?.data
        ? result.data.units
            .filter((u) => u.keel.etd_mm !== null)
            .sort((a, b) => (a.keel.etd_mm as number) - (b.keel.etd_mm as number))
            .slice(0, LOWEST_SHOWN)
        : [],
    [result],
  );
  const errors = result?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = result?.issues.filter((i) => i.level === "warn") ?? [];

  return (
    <div className="panel-surface rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-bold text-foreground">Import texture CSV</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Upload the 3–4 CSV files from hasil\&lt;runway&gt;\ of the TEKSTUR_2026 package (olah_tekstur.m). The conversion runs in the browser; the result is kept as a draft until you press Publish.
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
                  {s.id === SEED_TEXTURE_SURVEY_ID ? `${s.label} (built-in)` : `${s.label} (${s.id})`}
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
            <span className="block text-muted-foreground">Runway</span>
            <select
              className={`${field} w-[170px]`}
              value={runway}
              onChange={(e) => {
                const rw = e.target.value as RunwayId;
                setRunway(rw);
                setDate((d) => existing?.runways[rw]?.date ?? d);
                setLcmsTyped("");
                setResult(null);
              }}
            >
              {RUNWAY_IDS.map((r) => (
                <option key={r} value={r}>
                  {RW_LABEL[r]} ({TEXTURE_UNIT_COUNT[r]} units)
                </option>
              ))}
            </select>
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
            <span className="block text-muted-foreground">LCMS survey id (filled in by Process)</span>
            <input
              className={`${field} w-[190px]`}
              value={lcms}
              onChange={(e) => {
                setLcmsTyped(e.target.value);
                setResult(null);
              }}
            />
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
          Drag the CSV files here, or{" "}
          <button className="underline text-foreground" onClick={() => fileInput.current?.click()}>
            choose files
          </button>
          <p className="text-[11px] mt-1">Limits: 10 MB for the per-band file, 1 MB for the others. The log and PNG files are not needed.</p>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.txt,.png"
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
            <table className="w-full min-w-[560px] text-xs tabular-nums">
              <thead>
                <tr className="text-[10px] uppercase tracking-[.07em] text-muted-foreground border-b border-border text-left">
                  <th className={cell}>File</th>
                  <th className={cellRight}>Size</th>
                  <th className={cell}>Detected role</th>
                  <th className={cell}>Detected runway</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {picked.map((p) => {
                  const refused = p.role === "unknown" || p.role === "raw-lcms";
                  const otherRunway = p.runway !== null && p.runway !== runway;
                  return (
                    <tr key={p.name} className="border-b border-border/60">
                      <td className={`${cell} max-w-[300px] truncate`} title={p.name}>
                        {p.name}
                      </td>
                      <td className={`${cellRight} whitespace-nowrap`}>{(p.file.size / 1024).toLocaleString("en-US", { maximumFractionDigits: 0 })} KB</td>
                      <td className={`${cell} ${refused ? "text-destructive" : ""}`}>{ROLE_TEXT[p.role]}</td>
                      <td className={`${cell} ${otherRunway ? "text-destructive" : ""}`}>{p.runway ? RW_LABEL[p.runway] : "—"}</td>
                      <td className={cell}>
                        <button aria-label={`Remove ${p.name}`} className="p-1 text-muted-foreground hover:text-foreground" onClick={() => remove(p.name)}>
                          <X size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
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

            {result.data && (
              <>
                <div>
                  <h3 className="panel-label mb-1">FAA verdict per zone</h3>
                  <TextureZoneTable data={result.data} />
                </div>
                <div className="overflow-x-auto custom-scrollbar">
                  <h3 className="panel-label mb-1">The {LOWEST_SHOWN} units with the lowest keel ETD</h3>
                  <table className="w-full min-w-[520px] text-xs tabular-nums">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-[.07em] text-muted-foreground border-b border-border text-left">
                        <th className={cell}>Unit</th>
                        <th className={cell}>Zone</th>
                        <th className={cellRight}>ETD (mm)</th>
                        <th className={cellRight}>MPD (mm)</th>
                        <th className={cellRight}>SD (mm)</th>
                        <th className={cellRight}>n</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowest.map((u) => (
                        <tr key={u.unit} className="border-b border-border/60">
                          <td className={`${cell} font-mono`}>{u.unit}</td>
                          <td className={cell}>{u.zone}</td>
                          <td className={`${cellRight} font-mono`}>{u.keel.etd_mm?.toFixed(4)}</td>
                          <td className={`${cellRight} font-mono`}>{u.keel.mpd_mm?.toFixed(4)}</td>
                          <td className={`${cellRight} font-mono`}>{u.keel.sd_mm?.toFixed(4) ?? "—"}</td>
                          <td className={`${cellRight} font-mono`}>{u.keel.n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <Button size="sm" onClick={() => void save()} disabled={!result.data || busy !== null}>
              {busy === "save" ? <Spinner /> : <Save size={13} />} {busy === "save" ? "Saving…" : "Save to draft"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
