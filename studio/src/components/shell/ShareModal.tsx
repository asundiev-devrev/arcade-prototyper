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
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleClose() {
    setSelectedFrame(null);
    setShareUrl(null);
    setError(null);
    setCopied(false);
    onClose();
  }

  return (
    <Modal.Root open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>Share Frame</Modal.Title>
          <Modal.Description>
            Deploy a frame as a standalone preview on Vercel.
          </Modal.Description>
        </Modal.Header>

        <Modal.Body>
          {shareUrl ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: "var(--bg-success-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 540,
                    color: "var(--fg-success-prominent)",
                  }}
                >
                  Deployed successfully
                </div>
                <code
                  style={{
                    display: "block",
                    padding: 8,
                    borderRadius: 6,
                    background: "var(--bg-neutral-subtle)",
                    fontSize: 12,
                    wordBreak: "break-all",
                    userSelect: "all",
                  }}
                >
                  {shareUrl}
                </code>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {frames.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: "var(--fg-neutral-subtle)" }}>
                  This project has no frames yet. Generate one first, then come
                  back to share it.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {frames.map((frame) => {
                    const checked = selectedFrame === frame.slug;
                    return (
                      <label
                        key={frame.slug}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: 12,
                          borderRadius: 8,
                          cursor: "pointer",
                          border: `1px solid var(--stroke-neutral-${checked ? "prominent" : "subtle"})`,
                          background: checked ? "var(--bg-neutral-subtle)" : "transparent",
                        }}
                      >
                        <input
                          type="radio"
                          name="share-frame"
                          value={frame.slug}
                          checked={checked}
                          onChange={(e) => setSelectedFrame(e.target.value)}
                          style={{ width: 16, height: 16, flexShrink: 0 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 540 }}>{frame.name}</div>
                          <div style={{ fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
                            {frame.size}px
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    background: "var(--bg-alert-subtle)",
                    color: "var(--fg-alert-prominent)",
                    fontSize: 13,
                  }}
                >
                  {error}
                </div>
              )}
            </div>
          )}
        </Modal.Body>

        <Modal.Footer>
          {shareUrl ? (
            <>
              <Button
                variant="secondary"
                onClick={() => window.open(shareUrl, "_blank")}
              >
                Open in New Tab
              </Button>
              <Button variant="primary" onClick={handleCopy}>
                {copied ? "Copied!" : "Copy Link"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleDeploy}
                disabled={!selectedFrame || loading || frames.length === 0}
              >
                {loading ? "Deploying…" : "Deploy to Vercel"}
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
