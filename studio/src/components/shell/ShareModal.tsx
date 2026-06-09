import { useEffect, useRef, useState } from "react";
import { Modal, Button } from "@xorkavi/arcade-gen";
import type { Frame } from "../../../server/types";
import { wrapManifestWithPrompt } from "../../lift/wrapPrompt";
import { track } from "../../lib/telemetry/renderer";

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  projectSlug: string;
  frames: Frame[];
  // Test seams. The defaults (3s / 90s / 5s) match what real users
  // experience; tests pass tiny values so the probe loop runs in
  // milliseconds.
  probeIntervalMs?: number;
  probeTimeoutMs?: number;
  probeAttemptTimeoutMs?: number;
}

// First deploy on a freshly-created Cloudflare Pages project triggers
// async wildcard-cert issuance for `*.<project>.pages.dev`. Until the
// cert lands, the edge serves a default cert that doesn't match the
// host and the browser bails with `ERR_SSL_VERSION_OR_CIPHER_MISMATCH`.
// Cloudflare's API returns the URL the moment the deployment row is
// created — not when TLS is ready — so we have to probe client-side
// before showing the link to the user. Cap the wait so a genuinely
// stuck deploy still surfaces an actionable warning instead of
// spinning forever.
const PROBE_INTERVAL_MS = 3000;
const PROBE_TIMEOUT_MS = 90_000;
// Per-attempt cap so a single hung fetch can't block the loop. Cloudflare
// Access on *.pages.dev can redirect through an OTP gate that never
// resolves a no-cors fetch; without this, the global timeout never fires
// because the inner await sits forever.
const PROBE_ATTEMPT_TIMEOUT_MS = 5000;

type DeployPhase = "idle" | "deploying" | "provisioning" | "ready" | "timeout";

export function ShareModal({
  open,
  onClose,
  projectSlug,
  frames,
  probeIntervalMs = PROBE_INTERVAL_MS,
  probeTimeoutMs = PROBE_TIMEOUT_MS,
  probeAttemptTimeoutMs = PROBE_ATTEMPT_TIMEOUT_MS,
}: ShareModalProps) {
  const [selectedFrame, setSelectedFrame] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<DeployPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [manifestCopied, setManifestCopied] = useState(false);
  const probeAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      probeAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (open) track({ name: "share_opened", props: { frame_count: frames.length } });
  }, [open]);

  async function handleCopyManifest() {
    if (!selectedFrame) return;
    try {
      const res = await fetch(`/api/projects/${projectSlug}/lift/${selectedFrame}.xml`);
      if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
      const manifestXml = await res.text();
      // 0.16.1: ship the prompt alongside the manifest so the user can
      // paste it straight into Claude Code instead of hand-writing the
      // instructions themselves every time.
      const payload = wrapManifestWithPrompt({ manifestXml, frameSlug: selectedFrame });
      await navigator.clipboard.writeText(payload);
      setManifestCopied(true);
      setTimeout(() => setManifestCopied(false), 2000);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDeploy() {
    if (!selectedFrame) return;
    setLoading(true);
    setError(null);
    setPhase("deploying");
    track({ name: "share_started", props: { frame_count: frames.length, project_slug_hash: "" } });
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
      setPhase("provisioning");
      void probeUntilReady(data.url);
    } catch (err: any) {
      setError(err.message);
      setPhase("idle");
    } finally {
      setLoading(false);
    }
  }

  async function probeUntilReady(url: string) {
    probeAbort.current?.abort();
    const ctl = new AbortController();
    probeAbort.current = ctl;

    const start = Date.now();
    // `no-cors` lets us bypass the Access-Control-Allow-Origin gate the
    // Cloudflare Access redirect doesn't set; we just need TLS to
    // succeed. A reachable URL resolves the fetch (opaque response);
    // a TLS handshake failure rejects with TypeError("Failed to fetch")
    // — same code path the user's browser would hit on the URL itself,
    // which is the signal we want.
    while (!ctl.signal.aborted) {
      // Per-attempt timeout: Cloudflare Access can swallow a no-cors fetch
      // forever on a fresh project (redirect chain through an OTP gate that
      // never resolves). Race against an attempt-level abort so a hung
      // fetch counts as a failed probe instead of stalling the loop.
      const attemptCtl = new AbortController();
      const attemptTimer = setTimeout(
        () => attemptCtl.abort(),
        probeAttemptTimeoutMs,
      );
      const onOuterAbort = () => attemptCtl.abort();
      ctl.signal.addEventListener("abort", onOuterAbort);
      try {
        await fetch(url, {
          method: "GET",
          mode: "no-cors",
          cache: "no-store",
          signal: attemptCtl.signal,
        });
        if (ctl.signal.aborted) return;
        setPhase("ready");
        return;
      } catch (err: any) {
        if (ctl.signal.aborted) return;
        if (Date.now() - start >= probeTimeoutMs) {
          setPhase("timeout");
          return;
        }
        await new Promise((r) => setTimeout(r, probeIntervalMs));
      } finally {
        clearTimeout(attemptTimer);
        ctl.signal.removeEventListener("abort", onOuterAbort);
      }
    }
  }

  function handleCopy() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    track({ name: "share_url_copied", props: {} });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleClose() {
    probeAbort.current?.abort();
    setSelectedFrame(null);
    setShareUrl(null);
    setError(null);
    setCopied(false);
    setManifestCopied(false);
    setPhase("idle");
    onClose();
  }

  return (
    <Modal.Root open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>Share Frame</Modal.Title>
          <Modal.Description>
            Deploy a frame as a standalone preview on Cloudflare Pages.
          </Modal.Description>
        </Modal.Header>

        <Modal.Body>
          {shareUrl ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background:
                    phase === "ready"
                      ? "var(--bg-success-subtle)"
                      : phase === "timeout"
                      ? "var(--bg-alert-subtle)"
                      : "var(--bg-neutral-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 540,
                    color:
                      phase === "ready"
                        ? "var(--fg-success-prominent)"
                        : phase === "timeout"
                        ? "var(--fg-alert-prominent)"
                        : "var(--fg-neutral-prominent)",
                  }}
                >
                  {phase === "ready"
                    ? "Deployed successfully"
                    : phase === "timeout"
                    ? "Deployed, but the URL isn't responding yet"
                    : "Deployed — waiting for SSL certificate…"}
                </div>
                {phase === "provisioning" && (
                  <div style={{ fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
                    Cloudflare issues a fresh wildcard certificate for new
                    projects. This usually takes 30–90 seconds. You can open
                    the link now — your browser will show an SSL error until
                    the certificate lands, then load on refresh.
                  </div>
                )}
                {phase === "timeout" && (
                  <div style={{ fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
                    Cloudflare took longer than 90 seconds to issue the SSL
                    certificate. The URL below may still need another minute
                    before it loads — try again shortly.
                  </div>
                )}
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
                variant="secondary"
                onClick={handleCopyManifest}
                disabled={!selectedFrame || loading || frames.length === 0}
              >
                {manifestCopied ? "Copied!" : "Copy Lift Manifest"}
              </Button>
              <Button
                variant="primary"
                onClick={handleDeploy}
                disabled={!selectedFrame || loading || frames.length === 0}
              >
                {loading ? "Deploying…" : "Deploy to Cloudflare"}
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
