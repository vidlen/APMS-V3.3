import { useState } from "react";
import { toast } from "sonner";
import { CloudUpload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useData } from "@/lib/data-store";

// Admin edits stay a local draft until published here; publishing uploads the
// whole draft to Vercel Blob so every visitor sees it (see published-overrides.ts).
export default function PublishBar() {
  const { hasDraft, publishedStatus, publish } = useData();
  const [busy, setBusy] = useState(false);

  const handlePublish = async () => {
    setBusy(true);
    try {
      await publish();
      toast.success("Published. Other devices will show it within about a minute.");
    } catch (err) {
      console.error("Publish failed", err);
      const message = err instanceof Error ? err.message : "";
      toast.error(
        message.includes("presigned URL")
          ? "Upload not authorised. Your admin session may have expired: log in again and retry."
          : `Publish failed. ${message}`.trim()
      );
    } finally {
      setBusy(false);
    }
  };

  let status: string;
  if (publishedStatus === "loading") status = "Checking the published version…";
  else if (publishedStatus === "error")
    status = "The published version could not be loaded. Reload the page before publishing.";
  else if (hasDraft) status = "You have unpublished changes. Visitors still see the published version.";
  else status = "Everything is published. Visitors see what you see.";

  return (
    <div className="panel-surface rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <p
        className={`text-sm ${
          publishedStatus === "error" ? "text-destructive" : "text-muted-foreground"
        }`}
        role="status"
      >
        {status}
      </p>
      <Button
        size="sm"
        onClick={handlePublish}
        disabled={!hasDraft || publishedStatus !== "ready" || busy}
      >
        {busy ? <Spinner /> : <CloudUpload size={13} />}
        {busy ? "Publishing…" : "Publish"}
      </Button>
    </div>
  );
}
