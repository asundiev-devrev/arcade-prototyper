import { useEffect, useRef, useState } from "react";
import { Button, Modal, Input } from "@xorkavi/arcade-gen";

type Status =
  | { kind: "loading" }
  | { kind: "disconnected" }
  | { kind: "connected"; email?: string }
  | { kind: "error"; message: string };

export function FigmaConnectButton() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [modalOpen, setModalOpen] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function refreshStatus() {
    try {
      const res = await fetch("/api/figma/status");
      if (!mounted.current) return;
      if (!res.ok) { setStatus({ kind: "error", message: `status ${res.status}` }); return; }
      const body = await res.json();
      if (!mounted.current) return;
      if (body.authenticated) {
        setStatus({ kind: "connected", email: body?.user?.email });
      } else {
        setStatus({ kind: "disconnected" });
      }
    } catch (err: any) {
      if (!mounted.current) return;
      setStatus({ kind: "error", message: err?.message ?? String(err) });
    }
  }

  useEffect(() => { void refreshStatus(); }, []);

  if (status.kind === "loading") {
    return <span style={{ fontSize: 12, color: "var(--fg-neutral-subtle)" }}>Figma…</span>;
  }
  if (status.kind === "connected") {
    return (
      <span style={{ fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
        Figma: {status.email ?? "connected"}
      </span>
    );
  }
  if (status.kind === "error") {
    return (
      <Button variant="tertiary" size="sm" onClick={() => void refreshStatus()}>
        Figma error — retry
      </Button>
    );
  }
  return (
    <>
      <Button variant="tertiary" size="sm" onClick={() => setModalOpen(true)}>
        Connect Figma
      </Button>
      <FigmaConnectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onConnected={async () => {
          setModalOpen(false);
          await refreshStatus();
        }}
      />
    </>
  );
}

function FigmaConnectModal({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [pat, setPat] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const trimmed = pat.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/figma/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        throw new Error(body?.error?.message ?? `login failed: ${res.status}`);
      }
      setPat("");
      onConnected();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setPat("");
    setError(null);
    onClose();
  }

  return (
    <Modal.Root open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>Connect Figma</Modal.Title>
          <Modal.Description>
            Paste a Figma personal access token. Studio uses it to read frames
            you reference in the chat.
          </Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
              Generate a token at{" "}
              <a
                href="https://www.figma.com/settings"
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--fg-accent-prominent)", textDecoration: "underline" }}
              >
                figma.com/settings
              </a>{" "}
              → Security → Personal access tokens. Figma shows the token once —
              copy it straight into the box below.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label htmlFor="figma-pat" style={{ fontSize: 12, fontWeight: 540 }}>
                Personal access token
              </label>
              <Input
                id="figma-pat"
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder="figd_..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !submitting && pat.trim()) void handleSubmit();
                }}
              />
            </div>
            {error && (
              <div
                role="alert"
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "var(--bg-alert-subtle)",
                  color: "var(--fg-alert-prominent)",
                  fontSize: 12,
                }}
              >
                {error}
              </div>
            )}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={submitting || !pat.trim()}
          >
            {submitting ? "Connecting…" : "Connect"}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
