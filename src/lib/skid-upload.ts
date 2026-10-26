import { uploadPresigned } from "@vercel/blob/client";
import type { SkidSurveyRunwayEntry } from "@/lib/data-overrides";
import type { RunwayBuild } from "@/lib/skid-import";

// Talks to api/skid-files.ts. Pathnames carry the first 12 hex chars of the file's SHA-256, so an
// upload never overwrites a file visitors are reading (and re-saving the same import is a no-op).

const API_URL = "/api/skid-files";

async function sha256Hex(data: BufferSource): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const safeCsvName = (name: string) => `${name.replace(/\.csv$/i, "").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80) || "file"}.csv`;

/** "production" / "preview" / "development": the folder this deployment publishes into (same as overrides.json). */
async function blobEnv(): Promise<string> {
  const res = await fetch("/api/overrides", { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`/api/overrides answered ${res.status}`);
  const { pathname } = (await res.json()) as { pathname: string };
  const m = /^apms\/([^/]+)\//.exec(pathname);
  if (!m) throw new Error(`Unexpected publish path ${pathname}`);
  return m[1];
}

async function uploadSkidFile(pathname: string, body: Blob, contentType: "application/json" | "text/csv"): Promise<string> {
  const res = await uploadPresigned(pathname, body, { access: "public", contentType, handleUploadUrl: API_URL });
  return res.url;
}

/**
 * Uploads one built runway (units JSON, trace JSON, the raw CSVs) to Blob and returns the manifest entry.
 * Nothing is visible to visitors until the admin presses Publish.
 */
export async function uploadSkidRunway(
  surveyId: string,
  build: RunwayBuild,
  csvs: { name: string; text: string }[],
): Promise<SkidSurveyRunwayEntry> {
  if (!build.units || !build.trace) throw new Error("Nothing to upload: the import has errors.");
  const env = await blobEnv();
  const dir = `apms/${env}/skid/${surveyId}`;
  const rw = build.runway;
  const json = (v: unknown) => new Blob([JSON.stringify(v)], { type: "application/json" });

  const unitsBlob = json(build.units);
  const unitsHash = (await sha256Hex(await unitsBlob.arrayBuffer())).slice(0, 12);
  const unitsPath = `${dir}/units-${rw}-${unitsHash}.json`;

  // The trace names its sibling units file, so it is built (and hashed) after that name is known.
  const trace = { ...build.trace, source_units_file: `units-${rw}-${unitsHash}.json` };
  const traceBlob = json(trace);
  const traceHash = (await sha256Hex(await traceBlob.arrayBuffer())).slice(0, 12);
  const tracePath = `${dir}/trace-${rw}-${traceHash}.json`;

  const [unitsUrl, traceUrl] = await Promise.all([
    uploadSkidFile(unitsPath, unitsBlob, "application/json"),
    uploadSkidFile(tracePath, traceBlob, "application/json"),
  ]);

  const rawCsv: SkidSurveyRunwayEntry["rawCsv"] = [];
  for (const c of csvs) {
    const blob = new Blob([c.text], { type: "text/csv" });
    const sha256 = await sha256Hex(await blob.arrayBuffer());
    const url = await uploadSkidFile(`${dir}/raw/${sha256.slice(0, 12)}-${safeCsvName(c.name)}`, blob, "text/csv");
    rawCsv.push({ name: c.name, url, sha256 });
  }

  return {
    unitsUrl,
    traceUrl,
    rawCsv,
    startWib: build.units.survey.start_wib,
    lanes: build.units.lanes.filter((l) => l.measured !== false).map((l) => l.code),
    s0Mode: build.s0Mode ?? "gps",
    importedAt: build.units.source?.imported_at ?? new Date().toISOString(),
  };
}
