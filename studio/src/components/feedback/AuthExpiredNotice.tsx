import { useState } from "react";
import { Banner, Button } from "@xorkavi/arcade-gen";

/**
 * Shown when a chat turn fails with an AWS-auth signature (SSO expired,
 * credentials not configured, etc). Offers a one-click "Sign in" that
 * streams `aws sso login --profile dev` via /api/aws/sso-login so the
 * user doesn't have to leave the app for a Terminal session.
 *
 * Keeps the plain-Terminal instructions as a fallback — if the button
 * path fails (no aws CLI present, profile not configured, browser can't
 * open), the user still knows what to do manually.
 */

type LoginState = "idle" | "running" | "done" | "error";

export function AuthExpiredNotice() {
  const [state, setState] = useState<LoginState>("idle");
  const [lastLine, setLastLine] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function startLogin() {
    setState("running");
    setErrorMsg(null);
    setLastLine("Starting AWS SSO login…");
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
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          let ev: { kind: string; line?: string; ok?: boolean; error?: string };
          try { ev = JSON.parse(dataLine.slice(6)); }
          catch { continue; }
          if (ev.kind === "line" && typeof ev.line === "string") {
            setLastLine(ev.line);
          } else if (ev.kind === "end") {
            if (ev.ok) {
              setState("done");
              setLastLine("Signed in. Retry your prompt.");
            } else {
              setState("error");
              setErrorMsg(ev.error ?? "Sign-in failed.");
            }
          }
        }
      }
    } catch (e) {
      setState("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Banner intent={state === "done" ? "success" : "warning"}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div>
          <strong>
            {state === "done"
              ? "AWS session refreshed"
              : "Your AWS session looks expired"}
          </strong>
          {state !== "done" && (
            <div style={{ opacity: 0.9, fontSize: 13 }}>
              Sign in to refresh your Bedrock credentials. You'll approve a
              browser tab and come back here to retry.
            </div>
          )}
        </div>

        {state !== "done" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void startLogin()}
              disabled={state === "running"}
            >
              {state === "running" ? "Signing in…" : "Sign in to AWS"}
            </Button>
            {state === "running" && lastLine && (
              <span style={{ fontSize: 12, opacity: 0.8 }}>{lastLine}</span>
            )}
          </div>
        )}

        {state === "error" && errorMsg && (
          <div style={{ fontSize: 12, opacity: 0.9 }}>
            {errorMsg}
            <div style={{ marginTop: 4 }}>
              If that didn't work, run <code>aws sso login --profile dev</code>
              {" "}in a terminal.
            </div>
          </div>
        )}
      </div>
    </Banner>
  );
}
