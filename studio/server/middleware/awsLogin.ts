import type { IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";

/**
 * POST /api/aws/sso-login
 *
 * Spawns `aws sso login --profile dev` on behalf of the user so they
 * don't have to open Terminal. The CLI opens a browser tab for OAuth
 * and writes the resulting token into ~/.aws/sso/cache/. We stream
 * stdout/stderr to the client over SSE so the UI can show "opening
 * browser…" / "waiting for approval…" progress and then flip to
 * "Signed in" when the child exits 0.
 *
 * We rely on the launcher having put either a system `aws` or our
 * bundled `Resources/awscli/aws-cli/aws` on PATH — so spawn("aws", ...)
 * finds it either way.
 *
 * The profile name is hardcoded to "dev" to match what the launcher
 * writes into ~/.aws/config on first run. If a user customizes their
 * profile, they can still run `aws sso login --profile <theirs>` in
 * Terminal — we just optimize for the default path.
 */
function streamFrame(res: ServerResponse, frame: unknown) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(frame)}\n\n`);
  } catch {
    // peer gone — nothing we can do
  }
}

export function awsLoginMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    if (req.url !== "/api/aws/sso-login" || req.method !== "POST") return next?.();

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    let proc;
    try {
      proc = spawn("aws", ["sso", "login", "--profile", "dev"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (err: any) {
      streamFrame(res, {
        kind: "end",
        ok: false,
        error: `Couldn't spawn aws: ${err?.message ?? String(err)}`,
      });
      res.end();
      return;
    }

    // Push every line of stdout/stderr as an SSE "line" frame. The
    // CLI's output is already user-friendly ("Attempting to
    // automatically open the SSO authorization page in your default
    // browser…") so we pass it through verbatim.
    const push = (chunk: Buffer | string) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line) streamFrame(res, { kind: "line", line });
      }
    };
    proc.stdout!.on("data", push);
    proc.stderr!.on("data", push);

    // If the browser tab closes / the user hits cancel in the UI, kill
    // the subprocess so we don't leave a half-finished `aws sso login`
    // running forever.
    req.on("close", () => {
      try { proc!.kill("SIGTERM"); } catch {}
    });

    proc.on("error", (err: any) => {
      streamFrame(res, {
        kind: "end",
        ok: false,
        error: `aws process error: ${err?.message ?? String(err)}`,
      });
      res.end();
    });

    proc.on("close", (code) => {
      streamFrame(res, {
        kind: "end",
        ok: code === 0,
        code: code ?? 1,
      });
      res.end();
    });
  };
}
