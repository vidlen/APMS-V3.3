import { uploadPresigned } from "@vercel/blob/client";
import type { TextureBuild } from "@/lib/texture-import";
import type { TextureSurveyRunwayEntry } from "@/lib/data-overrides";
import { blobEnv, safeCsvName, sha256Hex } from "@/lib/skid-upload";
import type { RunwayId } from "@/types/skid";
import type { TextureFileRole } from "@/types/texture";

// Talks to api/texture-files.ts. Pathnames carry the first 12 hex chars of the file's SHA-256, so an
// upload never overwrites a file visitors are reading (and re-saving the same import is a no-op).

const API_URL = "/api/texture-files";

export interface TexturePickedFile {
  file: File;
  name: string;
  text: string;
  sha256: string;
  role: TextureFileRole | "unknown" | "raw-lcms";
  runway: RunwayId | null;
}

async function uploadTextureFile(pathname: string, body: Blob, contentType: "application/json" | "text/csv"): Promise<string> {
  const res = await uploadPresigned(pathname, body, { access: "public", contentType, handleUploadUrl: API_URL });
  return res.url;
}

/**
 * Uploads one built runway (units JSON, the raw CSVs) to Blob and returns the manifest entry.
 * The per-band CSV is not uploaded on either runway (the 07L/25R file is 5.56 MB, over the 5 MB limit): only its
 * name, hash and size are recorded. Nothing is visible to visitors until the admin presses Publish.
 */
export async function uploadTextureRunway(surveyId: string, build: TextureBuild, files: TexturePickedFile[]): Promise<TextureSurveyRunwayEntry> {
  if (!build.data) throw new Error("Nothing to upload: the import has errors.");
  const env = await blobEnv();
  const dir = `apms/${env}/texture/${surveyId}`;

  const blob = new Blob([JSON.stringify(build.data)], { type: "application/json" });
  const hash = (await sha256Hex(await blob.arrayBuffer())).slice(0, 12);
  const url = await uploadTextureFile(`${dir}/units-${build.data.runway}-${hash}.json`, blob, "application/json");

  const rawCsv: TextureSurveyRunwayEntry["rawCsv"] = [];
  for (const f of files) {
    const role = f.role as TextureFileRole; // a build without errors has exactly one file per role
    const csvUrl =
      role === "bands"
        ? null
        : await uploadTextureFile(`${dir}/raw/${f.sha256.slice(0, 12)}-${safeCsvName(f.name)}`, f.file.slice(0, f.file.size, "text/csv"), "text/csv");
    rawCsv.push({ role, name: f.name, url: csvUrl, sha256: f.sha256, bytes: f.file.size });
  }

  return {
    url,
    rawCsv,
    date: build.data.survey.date,
    lcmsSurveyId: build.data.survey.lcms_survey_id,
    importedAt: build.data.source.imported_at ?? new Date().toISOString(),
  };
}
