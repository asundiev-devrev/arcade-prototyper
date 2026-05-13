import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Modal } from "@xorkavi/arcade-gen";

type Status = "idle" | "connecting" | "joined" | "failed";

interface Props {
  sessionId: string;
  relayUrl: string;
  onJoined: (info: { sessionObject: string; driverDevu: string | null }) => void;
  onDismiss: () => void;
}

export function JoinSessionGate({ sessionId, relayUrl, onJoined, onDismiss }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const cleanup = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      try { ws.close(); } catch {}
    }
    wsRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const handleJoin = useCallback(async () => {
    setStatus("connecting");
    setError(null);

    // Read the guest's own PAT from the local Studio's keychain. This call
    // hits the guest's OWN localhost server, NOT the tunneled host.
    const patRes = await fetch("/api/settings/devrev-pat/raw").catch(() => null);
    const patBody = await patRes?.json().catch(() => null);
    const rawPat = patBody?.pat as string | null;
    if (!rawPat) {
      setStatus("failed");
      setError("DevRev PAT is required. Open Settings, paste your PAT, then try again.");
      return;
    }

    const wsBase = relayUrl.replace(/^http/, "ws");
    const url = `${wsBase}/api/multiplayer/ws?sessionId=${encodeURIComponent(sessionId)}&pat=${encodeURIComponent(rawPat)}`;
    // Browser WebSocket cannot set Authorization header, so the PAT goes
    // on the query string. The relay accepts both forms (see Task 10a).
    const ws = new WebSocket(url);
    wsRef.current = ws;

    let joined = false;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "session_state" && !joined) {
          joined = true;
          setStatus("joined");
          onJoined({
            sessionObject: msg.sessionObject,
            driverDevu: msg.driverDevu,
          });
        }
      } catch {
        // ignore non-JSON frames
      }
    };
    ws.onclose = (e) => {
      if (!joined) {
        setStatus("failed");
        setError(`Could not connect to the session (code ${e.code}).`);
      }
    };
    ws.onerror = () => {
      if (!joined) {
        setStatus("failed");
        setError("Could not connect — the host may be offline.");
      }
    };
  }, [relayUrl, sessionId, onJoined]);

  return (
    <Modal.Root open onOpenChange={(v) => { if (!v) onDismiss(); }}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>You've been invited</Modal.Title>
          <Modal.Description>
            A teammate has invited you to a live prototype session.
          </Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
              Session: <code>{sessionId}</code>
              <br />
              Host tunnel: <code>{relayUrl}</code>
            </p>
            {status === "failed" && error ? (
              <p style={{ fontSize: 13, color: "var(--fg-critical-prominent)" }}>{error}</p>
            ) : null}
            {status === "joined" ? (
              <p style={{ fontSize: 13, color: "var(--fg-success-prominent)" }}>
                Connected. Waiting for the host to drive…
              </p>
            ) : null}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={onDismiss} disabled={status === "connecting"}>
            Not now
          </Button>
          <Button
            variant="primary"
            onClick={handleJoin}
            disabled={status === "connecting" || status === "joined"}
          >
            {status === "connecting" ? "Connecting…" : "Join"}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
