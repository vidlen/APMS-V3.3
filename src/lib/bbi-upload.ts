import { uploadPresigned } from "@vercel/blob/client";
import type { BbiBuild } from "@/lib/bbi-import";
import type { BbiSurveyRunwayEntry } from "@/lib/data-overrides";
import { blobEnv, safeCsvName, sha256Hex } from "@/lib/skid-upload";
import type { BbiFileRole } from "@/types/bbi";

// Talks to api/bbi-files.ts. Pathnames carry the first 12 hex chars of the file's SHA-256, so an
// upload never overwrites a file visitors are reading (and re-saving the same import is a no-op).

const API_URL = "/api/bbi-files";

export interface BbiPickedFile {
  file: File;
  name: string;
  text: string;
  sha256: string;
  role: BbiFileRole | "unknown" | "old-numbering";
}

async function uploadBbiFile(pathname: string, body: Blob, contentType: "application/json" | "text/csv"): Promise<string> {
  const res = await uploadPresigned(pathname, body, { access: "public", contentType, handleUploadUrl: API_URL });
  return res.url;
}

/**
 * Uploads one built runway (units JSON, trace JSON, the raw CSVs) to Blob and returns the manifest entry.
 * The per-point CSV is not uploaded (7 MB, over the 5 MB limit): only its name, hash and size are recorded.
 * Nothing is visible to visitors until the admin presses Publish.
 */
export async function uploadBbiRunway(surveyId: string, build: BbiBuild, files: BbiPickedFile[]): Promise<BbiSurveyRunwayEntry> {
  if (!build.units || !build.trace) throw new Error("Nothing to upload: the import has errors.");
  const env = await blobEnv();
  const dir = `apms/${env}/bbi/${surveyId}`;
  const rw = build.units.runway;
  const json = (v: unknown) => new Blob([JSON.stringify(v)], { type: "application/json" });

  const unitsBlob = json(build.units);
  const unitsHash = (await sha256Hex(await unitsBlob.arrayBuffer())).slice(0, 12);
  const unitsName = `units-${rw}-${unitsHash}.json`;

  // The trace names its sibling units file, so it is built (and hashed) after that name is known.
  const traceBlob = json({ ...build.trace, source_units_file: unitsName });
  const traceHash = (await sha256Hex(await traceBlob.arrayBuffer())).slice(0, 12);

  const [unitsUrl, traceUrl] = await Promise.all([
    uploadBbiFile(`${dir}/${unitsName}`, unitsBlob, "application/json"),
    uploadBbiFile(`${dir}/trace-${rw}-${traceHash}.json`, traceBlob, "application/json"),
  ]);

  const rawCsv: BbiSurveyRunwayEntry["rawCsv"] = [];
  for (const f of files) {
    const role = f.role as BbiFileRole; // a build without errors has exactly one file per role
    const url =
      role === "points"
        ? null
        : await uploadBbiFile(`${dir}/raw/${f.sha256.slice(0, 12)}-${safeCsvName(f.name)}`, f.file.slice(0, f.file.size, "text/csv"), "text/csv");
    rawCsv.push({ role, name: f.name, url, sha256: f.sha256, bytes: f.file.size });
  }

  return {
    unitsUrl,
    traceUrl,
    rawCsv,
    date: build.units.survey.date,
    lines: build.units.lines.map((l) => l.code),
    importedAt: build.units.source.imported_at ?? new Date().toISOString(),
  };
}
