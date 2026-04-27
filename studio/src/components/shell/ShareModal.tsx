import { useState } from "react";
import { Modal, Button } from "@xorkavi/arcade-gen";
import type { Frame } from "../../../server/types";

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  projectSlug: string;
  frames: Frame[];
}

export function ShareModal({ open, onClose, projectSlug, frames }: ShareModalProps) {
  const [selectedFrame, setSelectedFrame] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleDeploy() {
    if (!selectedFrame) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/projects/${projectSlug}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frameSlug: selectedFrame }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error?.message || `Deploy failed: ${res.status}`);
      }

      const data = await res.json();
      setShareUrl(data.url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleClose() {
    setSelectedFrame(null);
    setShareUrl(null);
    setError(null);
    setCopied(false);
    onClose();
  }

  return (
    <Modal.Root open={open} onOpenChange={(open) => !open && handleClose()}>
      <Modal.Content>
        <Modal.Title>Share Frame</Modal.Title>

        <div className="space-y-4 py-4">
          {shareUrl ? (
            <>
              <div
                className="p-3 rounded-square"
                style={{ background: "var(--bg-success-subtle)" }}
              >
                <div
                  className="text-system-small font-medium mb-2"
                  style={{ color: "var(--fg-success-default)" }}
                >
                  Deployed successfully
                </div>
                <code
                  className="block p-2 rounded text-system-small break-all"
                  style={{ background: "var(--surface-backdrop)" }}
                >
                  {shareUrl}
                </code>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleCopy}
                  className="flex-1"
                >
                  {copied ? "Copied!" : "Copy Link"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => window.open(shareUrl, "_blank")}
                  className="flex-1"
                >
                  Open in New Tab
                </Button>
              </div>
            </>
          ) : (
            <>
              <div>
                <p
                  className="text-body-small mb-3"
                  style={{ color: "var(--fg-neutral-subtle)" }}
                >
                  Select a frame to deploy as a standalone preview on Vercel.
                </p>

                <div className="space-y-2">
                  {frames.map((frame) => (
                    <label
                      key={frame.slug}
                      className="flex items-center gap-3 p-3 rounded-square cursor-pointer"
                      style={{
                        border: "1px solid var(--stroke-neutral-subtle)",
                      }}
                    >
                      <input
                        type="radio"
                        name="frame"
                        value={frame.slug}
                        checked={selectedFrame === frame.slug}
                        onChange={(e) => setSelectedFrame(e.target.value)}
                        className="w-4 h-4"
                      />
                      <div className="flex-1">
                        <div className="text-body font-medium">{frame.name}</div>
                        <div
                          className="text-system-small"
                          style={{ color: "var(--fg-neutral-subtle)" }}
                        >
                          {frame.size}px
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {error && (
                <div
                  className="p-3 rounded-square text-body-small"
                  style={{
                    background: "var(--bg-error-subtle)",
                    color: "var(--fg-error-default)",
                  }}
                >
                  {error}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={handleDeploy}
                  disabled={!selectedFrame || loading}
                  className="flex-1"
                >
                  {loading ? "Deploying..." : "Deploy to Vercel"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleClose}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>

        {shareUrl && (
          <Modal.Close asChild>
            <Button variant="secondary" onClick={handleClose}>
              Close
            </Button>
          </Modal.Close>
        )}
      </Modal.Content>
    </Modal.Root>
  );
}
