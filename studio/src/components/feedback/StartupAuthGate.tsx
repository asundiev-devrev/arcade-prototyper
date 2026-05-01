import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@xorkavi/arcade-gen";

/**
 * Blocks the rest of the app until the user is signed in to AWS
 * Bedrock. Runs a single check on mount (`GET /api/aws/status`) and,
 * if unauthenticated, renders a full-viewport modal with a "Sign in
 * to AWS" button that streams `aws sso login --profile dev` the same
 * way the mid-session AuthExpiredNotice does.
 *
 * The point is to catch the "user types a prompt, hits Send, and
 * THEN discovers they're signed out" case — which loses the prompt
 * and is baffling for first-time users. We'd rather make the
 * precondition visible before they ever reach the chat input.
 */

type GateState =
  | { kind: "checking" }
  | { kind: "signedIn" }
  | { kind: "signedOut" }
  | { kind: "signingIn"; lastLine: string }
  | { kind: "error"; message: string };

interface StartupAuthGateProps {
  children: ReactNode;
}

export function StartupAuthGate({ children }: StartupAuthGateProps) {
  const [state, setState] = useState<GateState>({ kind: "checking" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/aws/status");
        if (cancelled) return;
        if (!res.ok) {
          // Treat a transport error as "can't verify — let the user in
          // and surface the real auth problem at chat-turn time".
          // Blocking on a 500 would be worse UX than the current
          // behavior.
          setState({ kind: "signedIn" });
          return;
        }
        const body = await res.json();
        setState({ kind: body?.authenticated ? "signedIn" : "signedOut" });
      } catch {
        if (!cancelled) setState({ kind: "signedIn" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function startLogin() {
    setState({ kind: "signingIn", lastLine: "Starting AWS SSO login…" });
    try {
      const res = await fetch("/api/aws/sso-login", { method: "POST" });
      if (!res.body) throw new Error(`login request failed: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          let ev: { kind: string; line?: string; ok?: boolean; error?: string };
          try { ev = JSON.parse(dataLine.slice(6)); } catch { continue; }
          if (ev.kind === "line" && typeof ev.line === "string") {
            setState({ kind: "signingIn", lastLine: ev.line });
          } else if (ev.kind === "end") {
            if (ev.ok) setState({ kind: "signedIn" });
            else setState({ kind: "error", message: ev.error ?? "Sign-in failed." });
          }
        }
      }
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (state.kind === "signedIn") return <>{children}</>;

  // Block everything behind a fixed-position overlay so the app can
  // still mount (saves us from thrashing the theme provider / router
  // between states) but is completely uninteractable until the gate
  // resolves.
  return (
    <>
      {children}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "var(--surface-backdrop, rgba(0,0,0,0.6))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10_000,
          backdropFilter: "blur(4px)",
        }}
        aria-modal="true"
        role="dialog"
        aria-labelledby="startup-auth-gate-title"
      >
        <div
          style={{
            maxWidth: 440,
            width: "90%",
            padding: 24,
            borderRadius: 12,
            background: "var(--surface-default, #fff)",
            boxShadow: "0 24px 48px rgba(0,0,0,0.2)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {state.kind === "checking" && (
            <div>
              <h2 id="startup-auth-gate-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                Checking AWS sign-in…
              </h2>
            </div>
          )}

          {state.kind === "signedOut" && (
            <>
              <h2 id="startup-auth-gate-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                Sign in to AWS to start
              </h2>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--fg-neutral-subtle, #555)" }}>
                Arcade Studio generates frames using Anthropic via AWS Bedrock.
                Sign in once to refresh your credentials — you'll approve a
                browser tab, then come back here.
              </p>
              <Button onClick={startLogin}>Sign in to AWS</Button>
              <p style={{ margin: 0, fontSize: 12, color: "var(--fg-neutral-subtle, #666)" }}>
                If the button doesn't work, run <code>aws sso login --profile dev</code> in Terminal, then reload this window.
              </p>
            </>
          )}

          {state.kind === "signingIn" && (
            <>
              <h2 id="startup-auth-gate-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                Signing you in…
              </h2>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--fg-neutral-subtle, #555)" }}>
                {state.lastLine}
              </p>
            </>
          )}

          {state.kind === "error" && (
            <>
              <h2 id="startup-auth-gate-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                Sign-in failed
              </h2>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--fg-critical-prominent, #c43)" }}>
                {state.message}
              </p>
              <Button onClick={startLogin}>Try again</Button>
              <p style={{ margin: 0, fontSize: 12, color: "var(--fg-neutral-subtle, #666)" }}>
                Still stuck? Run <code>aws sso login --profile dev</code> in Terminal and reload.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
