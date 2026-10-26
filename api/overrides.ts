import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac, timingSafeEqual } from "node:crypto";
import { head, issueSignedToken, BlobNotFoundError } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";

// Auth: every Blob call here uses OIDC (BLOB_STORE_ID + the OIDC token Vercel
// injects into each request). No BLOB_READ_WRITE_TOKEN is needed; presigned
// uploads also read BLOB_WEBHOOK_PUBLIC_KEY. All of these are added when the
// store is connected to the project.

// One published file per Vercel environment, so a test publish from
// `vercel dev` (development) or a Preview deployment never overwrites what
// Production visitors see. VERCEL_ENV is set by Vercel and by `vercel dev`.
const ENVIRONMENT = process.env.VERCEL_ENV ?? "development";
const PATHNAME = `apms/${ENVIRONMENT}/overrides.json`;

// Generous ceiling: a few imported GeoJSON years at ~1.4 MB each still fit.
// Client uploads go straight from the browser to Blob, so the 4.5 MB
// Vercel Function body limit does not apply here.
const MAX_BYTES = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Admin session check. COPIED from api/auth.ts on purpose: keeping each
// function self-contained avoids ESM import-path pitfalls on Vercel. The
// cookie name and signing scheme MUST stay identical to api/auth.ts - if you
// change one, change both.
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
// GET  /api/overrides -> { pathname, url } of the published file (url null
//                         until the first publish). Anyone may call it.
// POST /api/overrides -> presigned upload URL (handleUploadPresigned). The
//                         URL is only issued to a valid admin session.
// ---------------------------------------------------------------------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    try {
      const blob = await head(PATHNAME);
      // The URL never changes after the first publish (fixed pathname,
      // no random suffix), so the CDN may keep this answer for a day.
      // head() counts as a Blob "simple operation"; caching keeps it to
      // roughly one call per day per region instead of one per visit.
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400");
      res.status(200).json({ pathname: PATHNAME, url: blob.url });
    } catch (err) {
      if (err instanceof BlobNotFoundError) {
        // Nothing published yet: re-check within a minute.
        res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
        res.status(200).json({ pathname: PATHNAME, url: null });
        return;
      }
      console.error("Blob head failed", err);
      res.status(500).json({ error: "Could not reach the Blob store" });
    }
    return;
  }

  if (req.method === "POST") {
    try {
      const result = await handleUploadPresigned({
        body: req.body as HandleUploadPresignedBody,
        request: req,
        getSignedToken: async (pathname) => {
          // The ONLY thing standing between the public internet and your
          // Blob store: never return an upload URL without this check.
          if (!isAdminRequest(req)) {
            throw new Error("Admin session missing or expired");
          }
          if (pathname !== PATHNAME) {
            throw new Error(`Uploads are only allowed to ${PATHNAME}`);
          }
          const validUntil = Date.now() + 10 * 60 * 1000; // 10 minutes
          const token = await issueSignedToken({
            pathname: PATHNAME,
            operations: ["put"],
            allowedContentTypes: ["application/json"],
            maximumSizeInBytes: MAX_BYTES,
            validUntil,
          });
          return {
            token,
            urlOptions: {
              allowedContentTypes: ["application/json"],
              maximumSizeInBytes: MAX_BYTES,
              addRandomSuffix: false,
              allowOverwrite: true,
              validUntil,
              // No cacheControlMaxAge: the default long CDN cache is what we
              // want. An overwrite still reaches the CDN within ~60 s, and a
              // short max-age would turn many visits into billable cache misses.
            },
          };
        },
        // No onUploadCompleted: nothing to record after the upload, and
        // leaving it out means Blob never has to call back into this route
        // (which would not work on localhost anyway).
      });
      res.status(200).json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Upload refused" });
    }
    return;
  }

  res.setHeader("Allow", "GET, POST");
  res.status(405).json({ error: "Method not allowed" });
}
