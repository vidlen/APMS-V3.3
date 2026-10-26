import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac, timingSafeEqual } from "node:crypto";
import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";

// Upload permission for the skid-resistance files an admin imports from Moventor CSVs
// (units / trace JSON and the raw CSV). Same shape as api/overrides.ts: auth is OIDC,
// the browser uploads straight to Blob, and no URL is issued without an admin session.
const ENVIRONMENT = process.env.VERCEL_ENV ?? "development";

// ---------------------------------------------------------------------------
// Admin session check. COPIED from api/auth.ts (and api/overrides.ts) on purpose:
// cookie name and signing scheme MUST stay identical - change one, change all.
// ---------------------------------------------------------------------------
const COOKIE_NAME = "apms_admin_session";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function verifyToken(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  if (!safeEqual(signature, sign(payload, secret))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof exp === "number" && Date.now() < exp;
  } catch {
    return false;
  }
}

function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function isAdminRequest(req: VercelRequest): boolean {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  return verifyToken(readCookie(req.headers.cookie, COOKIE_NAME), secret);
}

// ---------------------------------------------------------------------------
// Which pathnames may be uploaded, and as what. Pure so it can be tested.
// The hash in the name is the first 12 hex chars of the file's SHA-256, so an
// upload never overwrites a file visitors are reading.
// ---------------------------------------------------------------------------
export function skidUploadRule(
  pathname: string,
  env: string,
): { contentType: "application/json" | "text/csv"; maxBytes: number } | null {
  const base = `apms/${env}/skid/`;
  const json = new RegExp(`^${base}[a-z0-9-]{1,40}/(units|trace)-(06-24|07L-25R)-[0-9a-f]{12}\\.json$`);
  const csv = new RegExp(`^${base}[a-z0-9-]{1,40}/raw/[0-9a-f]{12}-[A-Za-z0-9._-]{1,80}\\.csv$`);
  if (json.test(pathname)) return { contentType: "application/json", maxBytes: 5 * 1024 * 1024 };
  if (csv.test(pathname)) return { contentType: "text/csv", maxBytes: 5 * 1024 * 1024 };
  return null;
}

// POST /api/skid-files -> presigned upload URL (handleUploadPresigned), admin session only.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const result = await handleUploadPresigned({
      body: req.body as HandleUploadPresignedBody,
      request: req,
      getSignedToken: async (pathname) => {
        if (!isAdminRequest(req)) throw new Error("Admin session missing or expired");
        const rule = skidUploadRule(pathname, ENVIRONMENT);
        if (!rule) throw new Error("Pathname not allowed for skid uploads");
        const validUntil = Date.now() + 10 * 60 * 1000; // 10 minutes
        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          allowedContentTypes: [rule.contentType],
          maximumSizeInBytes: rule.maxBytes,
          validUntil,
        });
        return {
          token,
          urlOptions: {
            allowedContentTypes: [rule.contentType],
            maximumSizeInBytes: rule.maxBytes,
            addRandomSuffix: false,
            // The name carries the content hash, so an overwrite is always identical bytes.
            allowOverwrite: true,
            validUntil,
          },
        };
      },
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Upload refused" });
  }
}
