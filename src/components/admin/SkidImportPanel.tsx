import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Save, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { LANE_ORDER, classifySkid, SKID_CLASS_META } from "@/config/skid";
import stationTable from "@/config/skid-unit-stations-2026.json";
import { useCachedLoad } from "@/hooks/useSkidData";
import { useData } from "@/lib/data-store";
import { summarize } from "@/lib/skid";
import { buildSurvey, type Issue, type RunwayBuild, type StationTable } from "@/lib/skid-import";
import { loadJson, SkidRunwaySchema } from "@/lib/skid-schema";
import { listSkidSurveys } from "@/lib/skid-surveys";
import { uploadSkidRunway } from "@/lib/skid-upload";
import type { LaneCode, RunwayId, SkidRunwayData } from "@/types/skid";

const MAX_FILES = 16;
const MAX_BYTES = 5 * 1024 * 1024;
const RUNWAY_IDS: RunwayId[] = ["06-24", "07L-25R"];
const RW_LABEL: Record<RunwayId, string> = { "06-24": "RWY 06/24", "07L-25R": "RWY 07L/25R" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const STATIONS = stationTable as unknown as StationTable;

interface Picked { name: string; text: string; runway: RunwayId | null; lane: LaneCode | null }
type S0Edits = Partial<Record<RunwayId, Partial<Record<LaneCode, number>>>>;

const cell = "px-2 py-1.5 align-top";
const sel = "h-7 rounded-md border border-input bg-card px-1 text-xs text-foreground";

async function loadSeeds(): Promise<Record<RunwayId, SkidRunwayData>> {
  const [a, b] = await Promise.all(RUNWAY_IDS.map((rw) => loadJson(`/data/skid-${rw}-2026.json`, SkidRunwaySchema)));
  return { "06-24": a, "07L-25R": b };
}

function IssueList({ issues, tone }: { issues: Issue[]; tone: "error" | "warn" }) {
  if (issues.length === 0) return null;
  return (
    <ul className={`text-[11px] leading-snug ${tone === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>
      {issues.map((i, k) => (
        <li key={k}>{i.message}</li>
      ))}
    </ul>
  );
}

// Admin -> Skid Resistance: Moventor CSVs in, the two JSON files the Skid tab already reads out.
// Everything is computed in the browser (src/lib/skid-import.ts); Save uploads the files to Blob and records
// the survey in the draft. Visitors see it only after Publish.
export default function SkidImportPanel() {
  const { overrides, upsertSkidSurveyRunway } = useData();
  const seeds = useCachedLoad("skid-seed-units-admin", loadSeeds);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [s0Edits, setS0Edits] = useState<S0Edits>({});
  const [useOldS0, setUseOldS0] = useState<Partial<Record<RunwayId, boolean>>>({});
  const [idOverride, setIdOverride] = useState<string | null>(null);
  const [labelOverride, setLabelOverride] = useState<string | null>(null);
  const [processed, setProcessed] = useState<Partial<Record<RunwayId, RunwayBuild>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const surveys = useMemo(() => listSkidSurveys(overrides.skidSurveys), [overrides.skidSurveys]);

  // ---- target survey: id/label from the earliest file (WIB), or an existing survey
  const preview0 = useMemo(
    () => (seeds.data ? buildSurvey(picked, seeds.data, STATIONS) : null),
    [picked, seeds.data],
  );
  const earliest = preview0?.files.map((f) => f.stats?.startWib ?? "").filter(Boolean).sort()[0] ?? "";
  const autoId = earliest ? earliest.slice(0, 7) : "";
  const autoLabel = earliest ? `${MONTHS[Number(earliest.slice(5, 7)) - 1]} ${earliest.slice(0, 4)}` : "";
  const surveyId = idOverride ?? autoId;
  const existing = surveys.find((s) => s.id === surveyId);
  const label = labelOverride ?? existing?.label ?? autoLabel;
  const idValid = /^[a-z0-9-]{1,40}$/.test(surveyId);

  // ---- old files of the runways being replaced (defaults for s0 and the diff table)
  const replaceUrls = RUNWAY_IDS.flatMap((rw) => {
    const url = existing?.runways[rw]?.unitsUrl;
    return picked.some((p) => p.runway === rw) && url ? [[rw, url] as const] : [];
  });
  const old = useCachedLoad(
    replaceUrls.length ? `skid-old-units:${replaceUrls.map(([r, u]) => `${r}=${u}`).join("|")}` : null,
    async () => Object.fromEntries(await Promise.all(replaceUrls.map(async ([rw, url]) => [rw, await loadJson(url, SkidRunwaySchema)] as const))) as Partial<Record<RunwayId, SkidRunwayData>>,
  );
  const oldS0 = (rw: RunwayId): Partial<Record<LaneCode, number>> => {
    const o = old.data?.[rw];
    if (!o || useOldS0[rw] === false) return {};
    return Object.fromEntries(o.lanes.filter((l) => l.measured !== false && l.s0_m !== null).map((l) => [l.code, l.s0_m as number]));
  };
  const s0For = (rw: RunwayId) => ({ ...oldS0(rw), ...s0Edits[rw] });

  const build = useMemo(
    () =>
      seeds.data
        ? buildSurvey(picked, seeds.data, STATIONS, { s0: { "06-24": s0For("06-24"), "07L-25R": s0For("07L-25R") } })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picked, seeds.data, s0Edits, useOldS0, old.data],
  );

  const reset = () => {
    setProcessed(null);
  };

  const addFiles = async (list: FileList | File[]) => {
    const files = [...list].filter((f) => /\.csv$/i.test(f.name));
    if (files.length < [...list].length) toast.error("Hanya berkas .csv yang diterima (ekstrak .zip dulu).");
    const room = MAX_FILES - picked.length;
    if (files.length > room) toast.error(`Maksimal ${MAX_FILES} berkas per proses.`);
    const next: Picked[] = [];
    for (const f of files.slice(0, Math.max(0, room))) {
      if (f.size > MAX_BYTES) { toast.error(`${f.name}: lebih dari 5 MB.`); continue; }
      if (picked.some((p) => p.name === f.name) || next.some((p) => p.name === f.name)) continue;
      next.push({ name: f.name, text: await f.text(), runway: null, lane: null });
    }
    if (next.length) { setPicked((p) => [...p, ...next]); reset(); }
  };

  const patch = (name: string, change: Partial<Picked>) => {
    setPicked((p) => p.map((x) => (x.name === name ? { ...x, ...change } : x)));
    reset();
  };
  const remove = (name: string) => { setPicked((p) => p.filter((x) => x.name !== name)); reset(); };

  const fileIssues = (name: string) => {
    const f = build?.files.find((x) => x.name === name);
    const fromRunway = RUNWAY_IDS.flatMap((rw) => build?.runways[rw]?.errors.filter((i) => i.file === name) ?? []);
    const warnRunway = RUNWAY_IDS.flatMap((rw) => build?.runways[rw]?.warnings.filter((i) => i.file === name) ?? []);
    return { errors: [...(f?.errors ?? []), ...fromRunway], warnings: [...(f?.warnings ?? []), ...warnRunway] };
  };

  const runwayWarnings = (rw: RunwayId): Issue[] => {
    const b = build?.runways[rw];
    const out = b?.warnings.filter((i) => !i.file) ?? [];
    if (existing?.runways[rw]) out.push({ code: "replace", message: `${RW_LABEL[rw]} sudah ada di survei ${existing.label} (${existing.id}); impor akan menggantikannya.` });
    return out;
  };
  const runwayErrors = (rw: RunwayId): Issue[] => build?.runways[rw]?.errors.filter((i) => !i.file) ?? [];

  const hasErrors = !build || build.errors.length > 0 || picked.length === 0 || !idValid || label.trim() === "";

  const process = () => {
    if (!build || hasErrors) return;
    const stamp = new Date().toISOString();
    // Rebuild with a single import timestamp so what is shown is what is saved.
    const fresh = buildSurvey(picked, seeds.data as Record<RunwayId, SkidRunwayData>, STATIONS, {
      s0: { "06-24": s0For("06-24"), "07L-25R": s0For("07L-25R") },
      importedAt: stamp,
    });
    if (fresh.errors.length) { toast.error("Proses gagal; periksa galat di tabel."); return; }
    setProcessed(fresh.runways);
  };

  const save = async () => {
    if (!processed) return;
    setBusy(true);
    try {
      for (const rw of RUNWAY_IDS) {
        const b = processed[rw];
        if (!b?.units) continue;
        const csvs = picked.filter((p) => build?.files.find((f) => f.name === p.name)?.runway === rw);
        const entry = await uploadSkidRunway(surveyId, b, csvs);
        upsertSkidSurveyRunway(surveyId, label.trim(), rw, entry);
      }
      toast.success("Tersimpan sebagai draf. Tekan Publish supaya pengunjung melihatnya.");
      setPicked([]); setS0Edits({}); setUseOldS0({}); setIdOverride(null); setLabelOverride(null); setProcessed(null);
    } catch (err) {
      console.error("Skid import save failed", err);
      const message = err instanceof Error ? err.message : "";
      toast.error(
        message.includes("presigned URL") || message.includes("Admin session")
          ? "Unggahan ditolak. Sesi admin mungkin habis: login ulang lalu coba lagi."
          : `Gagal menyimpan. ${message}`.trim(),
      );
    } finally {
      setBusy(false);
    }
  };

  const num = (v: number | null | undefined, d: number) => (v === null || v === undefined ? "—" : v.toFixed(d));
  const runwaysInUse = RUNWAY_IDS.filter((rw) => picked.some((p) => (build?.files.find((f) => f.name === p.name)?.runway ?? p.runway) === rw));

  return (
    <div className="panel-surface rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-bold text-foreground">Impor CSV Skiddometer</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Unggah ekspor Moventor mentah (1–8 lajur per runway). Konversi dilakukan di browser; hasilnya tersimpan sebagai draf sampai Publish ditekan.
        </p>
      </div>

      <div className="p-4 space-y-4">
        {seeds.error && <p className="text-sm text-destructive">Berkas acuan (seed) gagal dimuat: {seeds.error}</p>}

        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files); }}
          className={`rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground ${drag ? "border-primary bg-secondary" : "border-border"}`}
        >
          <Upload size={16} className="mx-auto mb-1.5" />
          Seret berkas .csv ke sini, atau{" "}
          <button className="underline text-foreground" onClick={() => fileInput.current?.click()}>pilih berkas</button>
          <p className="text-[11px] mt-1">Maksimal {MAX_FILES} berkas, 5 MB per berkas.</p>
          <input
            ref={fileInput}
            type="file"
            accept=".csv"
            multiple
            className="hidden"
            onChange={(e) => { void addFiles(e.target.files ?? []); e.target.value = ""; }}
          />
        </div>

        {picked.length > 0 && build && (
          <>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[1100px] text-xs tabular-nums">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[.07em] text-muted-foreground border-b border-border text-left">
                    <th className={cell}>Berkas</th><th className={cell}>Runway</th><th className={cell}>Lajur</th>
                    <th className={cell}>Mulai (WIB)</th><th className={`${cell} text-right`}>Baris</th>
                    <th className={`${cell} text-right`}>μ rata-rata</th><th className={`${cell} text-right`}>Kecepatan</th>
                    <th className={`${cell} text-right`}>GPS</th><th className={cell}>s0 (m)</th>
                    <th className={`${cell} text-right`}>Lateral GPS</th><th className={cell}>Status</th><th />
                  </tr>
                </thead>
                <tbody>
                  {picked.map((p) => {
                    const f = build.files.find((x) => x.name === p.name);
                    const rw = f?.runway ?? null;
                    const a = rw ? build.runways[rw]?.lanes.find((l) => l.file === p.name) : undefined;
                    const { errors, warnings } = fileIssues(p.name);
                    const st = f?.stats;
                    return (
                      <tr key={p.name} className="border-b border-border/60">
                        <td className={`${cell} max-w-[220px] truncate`} title={p.name}>{p.name}</td>
                        <td className={cell}>
                          <select className={sel} value={f?.runway ?? ""} onChange={(e) => patch(p.name, { runway: (e.target.value || null) as RunwayId | null })}>
                            <option value="">—</option>
                            {RUNWAY_IDS.map((r) => <option key={r} value={r}>{RW_LABEL[r]}</option>)}
                          </select>
                        </td>
                        <td className={cell}>
                          <select className={sel} value={f?.lane ?? ""} onChange={(e) => patch(p.name, { lane: (e.target.value || null) as LaneCode | null })}>
                            <option value="">—</option>
                            {LANE_ORDER.map((l) => <option key={l} value={l}>{l}</option>)}
                          </select>
                        </td>
                        <td className={`${cell} whitespace-nowrap`}>{st?.startWib || "—"}</td>
                        <td className={`${cell} text-right`}>{st?.rows ?? "—"}</td>
                        <td className={`${cell} text-right`}>{num(st?.meanMu, 4)}</td>
                        <td className={`${cell} text-right whitespace-nowrap`}>
                          {num(st?.meanSpeed, 2)}{st && st.outsideSpeed > 0 ? ` (${st.outsideSpeed} di luar)` : ""}
                        </td>
                        <td className={`${cell} text-right`}>{st?.gpsRows ?? "—"}</td>
                        <td className={cell}>
                          <input
                            type="number"
                            step="0.1"
                            className={`${sel} w-[84px] text-right`}
                            value={a?.s0 ?? ""}
                            placeholder="auto"
                            title={a ? `${a.s0Source ?? ""}${a.s0Auto !== null ? ` · dari GPS: ${a.s0Auto}` : ""}${a.iqr !== null ? ` · sebaran GPS (IQR): ${a.iqr} m` : ""}` : ""}
                            disabled={!rw || !f?.lane}
                            onChange={(e) => {
                              const v = e.target.value === "" ? undefined : Number(e.target.value);
                              if (!rw || !f?.lane) return;
                              setS0Edits((s) => ({ ...s, [rw]: { ...s[rw], [f.lane as LaneCode]: v } }));
                              reset();
                            }}
                          />
                        </td>
                        <td className={`${cell} text-right`}>{a?.lateralResidual != null ? `${a.lateralResidual} m` : "—"}</td>
                        <td className={cell}>
                          {errors.length === 0 && warnings.length === 0 ? <span className="text-emerald-600">OK</span> : (
                            <>
                              <IssueList issues={errors} tone="error" />
                              <IssueList issues={warnings} tone="warn" />
                            </>
                          )}
                        </td>
                        <td className={cell}>
                          <button aria-label={`Hapus ${p.name}`} className="p-1 text-muted-foreground hover:text-foreground" onClick={() => remove(p.name)}>
                            <X size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {runwaysInUse.map((rw) => (
              <div key={rw} className="space-y-1">
                <IssueList issues={runwayErrors(rw)} tone="error" />
                <IssueList issues={runwayWarnings(rw)} tone="warn" />
                {old.data?.[rw] && (
                  <p className="text-[11px] text-muted-foreground">
                    s0 awal diambil dari survei lama.{" "}
                    <button className="underline" onClick={() => { setUseOldS0((u) => ({ ...u, [rw]: false })); setS0Edits((s) => ({ ...s, [rw]: {} })); reset(); }}>
                      Hitung dari GPS
                    </button>
                  </p>
                )}
              </div>
            ))}

            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs space-y-1">
                <span className="block text-muted-foreground">Survei tujuan</span>
                <select className={`${sel} h-8 w-[200px]`} value={existing ? surveyId : ""} onChange={(e) => { setIdOverride(e.target.value || null); setLabelOverride(null); reset(); }}>
                  <option value="">Baru: {autoId || "—"}</option>
                  {surveys.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.id})</option>)}
                </select>
              </label>
              <label className="text-xs space-y-1">
                <span className="block text-muted-foreground">Id</span>
                <input className={`${sel} h-8 w-[120px]`} value={surveyId} onChange={(e) => { setIdOverride(e.target.value.toLowerCase()); reset(); }} aria-invalid={!idValid} />
              </label>
              <label className="text-xs space-y-1">
                <span className="block text-muted-foreground">Label</span>
                <input className={`${sel} h-8 w-[140px]`} value={label} onChange={(e) => { setLabelOverride(e.target.value); reset(); }} />
              </label>
              <Button size="sm" onClick={process} disabled={hasErrors || busy}>
                <Play size={13} /> Proses
              </Button>
            </div>
            {!idValid && surveyId !== "" && <p className="text-[11px] text-destructive">Id hanya boleh huruf kecil, angka, dan tanda hubung (maks. 40).</p>}
          </>
        )}

        {processed && (
          <div className="space-y-3 border-t border-border pt-4">
            {RUNWAY_IDS.map((rw) => {
              const b = processed[rw];
              if (!b?.units) return null;
              const u = b.units;
              const s = summarize(u, "10m");
              const o = old.data?.[rw];
              const changed = o ? u.units.filter((x, i) => classifySkid(x.governing_10m?.mu ?? null) !== classifySkid(o.units[i]?.governing_10m?.mu ?? null)).length : 0;
              return (
                <div key={rw} className="text-xs space-y-1">
                  <h3 className="font-bold text-foreground">{RW_LABEL[rw]}</h3>
                  <p className="text-muted-foreground">
                    Cakupan: unit {u.coverage.first_unit}–{u.coverage.last_unit} ({u.coverage.n_units} dari {u.coverage.n_units_total}) ·{" "}
                    {(["belowMinimum", "belowMaintenance", "aboveMaintenance", "newDesign"] as const).map((c) => (
                      <span key={c} className="mr-2 inline-flex items-center gap-1">
                        <span className="inline-block w-2.5 h-2.5 rounded-sm border border-border" style={{ backgroundColor: SKID_CLASS_META[c].color }} />
                        {s.counts[c]}
                      </span>
                    ))}
                    · terendah:{" "}
                    {s.lowest ? `unit ${s.lowest.unit}, ${s.lowest.lane}, μ ${s.lowest.mu.toFixed(4)}` : "—"}
                  </p>
                  {o && (
                    <p className="text-muted-foreground">
                      Dibanding survei lama: {changed} unit berubah kelas · selisih s0:{" "}
                      {u.lanes.filter((l) => l.measured !== false).map((l) => {
                        const ol = o.lanes.find((x) => x.code === l.code);
                        return `${l.code} ${ol?.s0_m != null && l.s0_m != null ? (l.s0_m - ol.s0_m).toFixed(1) : "—"}`;
                      }).join(", ")}
                    </p>
                  )}
                </div>
              );
            })}
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? <Spinner /> : <Save size={13} />} {busy ? "Menyimpan…" : "Simpan ke draf"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
