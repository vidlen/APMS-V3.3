import { uploadPresigned } from "@vercel/blob/client";
import { normalizeOverrides, type DataOverrides } from "@/lib/data-overrides";

// Talks to api/overrides.ts. The published file lives in Vercel Blob (public
// store); this module only knows how to find it, read it and replace it.

const API_URL = "/api/overrides";
const TIMEOUT_MS = 10_000;

interface PublishedInfo {
  /** Where this deployment publishes to, e.g. apms/production/overrides.json */
  pathname: string;
  /** Public Blob URL, or null before the first publish. */
  url: string | null;
}

async function fetchPublishedInfo(): Promise<PublishedInfo> {
  const res = await fetch(API_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${API_URL} answered ${res.status}`);
  return (await res.json()) as PublishedInfo;
}

/**
 * The overrides every visitor should see, or null when nothing has been
 * published yet (or the file was deleted from the Blob store).
 */
export async function fetchPublishedOverrides(): Promise<DataOverrides | null> {
  const { url } = await fetchPublishedInfo();
  if (!url) return null;
  // no-store skips the BROWSER cache only; the request is still answered by
  // Vercel's CDN, which picks up a new publish within about a minute.
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Published file answered ${res.status}`);
  return normalizeOverrides(await res.json());
}

/**
 * Uploads the whole overrides object as the new published version. The
 * browser sends the file straight to Blob after api/overrides.ts has checked
 * the admin session cookie and handed back a short-lived presigned upload URL.
 */
export async function publishOverrides(overrides: DataOverrides): Promise<void> {
  const { pathname } = await fetchPublishedInfo();
  const body = new Blob([JSON.stringify(overrides)], { type: "application/json" });
  await uploadPresigned(pathname, body, {
    access: "public",
    contentType: "application/json",
    handleUploadUrl: API_URL,
  });
}
