import { useEffect, useRef, useState } from "react";
import { Button } from "@xorkavi/arcade-gen";

type Status =
  | { kind: "loading" }
  | { kind: "disconnected" }
  | { kind: "connected"; email?: string }
  | { kind: "error"; message: string };

export function FigmaConnectButton() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [loggingIn, setLoggingIn] = useState(false);

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

  async function startLogin() {
    if (loggingIn) return;
    setLoggingIn(true);
    try {
      // figmanage login opens a browser and writes a token to the keychain.
      // The endpoint streams output via SSE; we just wait for `end`.
      const res = await fetch("/api/figma/auth/login", { method: "POST" });
      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // SSE frames delimited by blank lines. Look for kind:"end".
          const chunk = decoder.decode(value);
          if (/"kind":"end"/.test(chunk)) break;
        }
      }
      if (!mounted.current) return;
      await refreshStatus();
    } catch (err: any) {
      if (!mounted.current) return;
      setStatus({ kind: "error", message: err?.message ?? String(err) });
    } finally {
      if (mounted.current) setLoggingIn(false);
    }
  }

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
    <Button variant="tertiary" size="sm" onClick={() => void startLogin()} disabled={loggingIn}>
      {loggingIn ? "Connecting…" : "Connect Figma"}
    </Button>
  );
}
