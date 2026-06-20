import type { IncomingMessage, ServerResponse } from "node:http";
import { figmaWhoami, figmaLoginWithPat, figmaLogout, parseFigmaUrl } from "../figmaCli";
import { getFigmaIngest } from "../figmaIngest";

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function figmaMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    if (!url.startsWith("/api/figma")) return next?.();
    try {
      if (url === "/api/figma/status") {
        return send(res, 200, await figmaWhoami());
      }

      if (req.method === "POST" && url === "/api/figma/ingest") {
        let buf = ""; for await (const c of req) buf += c;
        let body: { url?: string; fileKey?: string; nodeId?: string };
        try { body = buf ? JSON.parse(buf) : {}; }
        catch {
          return send(res, 400, { error: { code: "bad_request", message: "Invalid JSON body" } });
        }

        let fileKey = body.fileKey;
        let nodeId = body.nodeId;
        let sourceUrl = body.url ?? "";
        if ((!fileKey || !nodeId) && body.url) {
          const parsed = parseFigmaUrl(body.url);
          if (!parsed) {
            return send(res, 400, { error: { code: "bad_url", message: "URL is not a recognized Figma link" } });
          }
          fileKey = parsed.fileId;
          nodeId = parsed.nodeId;
          sourceUrl = body.url;
        }
        if (!fileKey || !nodeId) {
          return send(res, 400, { error: { code: "bad_request", message: "url or (fileKey + nodeId) required" } });
        }

        // Use ingestPhase1 so the prefetch returns as soon as the
        // deterministic half is cached (tree + tokens + PNG, 3–8s).
        // The classifier (phase 2) runs in the background and upgrades
        // the cache entry in place — the UI never waits on it.
        const ingest = await getFigmaIngest();
        const outcome = await ingest.ingestPhase1(fileKey, nodeId, sourceUrl || `figma://${fileKey}/${nodeId}`);
        return send(res, 200, outcome);
      }

      // POST /api/figma/auth/login { pat: "figd_..." }
      // figmanage's `login` is interactive (reads PAT on stdin). We pipe
      // the user's token in and return a simple ok/error JSON response.
      // No streaming needed — figmanage validates PATs synchronously.
      if (req.method === "POST" && url === "/api/figma/auth/login") {
        let buf = ""; for await (const c of req) buf += c;
        let body: { pat?: string };
        try { body = buf ? JSON.parse(buf) : {}; }
        catch {
          return send(res, 400, { error: { code: "bad_request", message: "Invalid JSON body" } });
        }
        const pat = body.pat?.trim();
        if (!pat) {
          return send(res, 400, {
            error: { code: "missing_pat", message: "Figma personal access token required" },
          });
        }
        const result = await figmaLoginWithPat(pat);
        if (!result.ok) {
          return send(res, 400, {
            error: { code: "login_failed", message: result.message || "figmanage login failed" },
          });
        }
        return send(res, 200, { ok: true });
      }

      // DELETE /api/figma/auth — remove stored PAT. Used by the "Remove"
      // button in the Settings modal's Figma section, mirroring the
      // DevRev disconnect flow.
      if (req.method === "DELETE" && url === "/api/figma/auth") {
        const result = await figmaLogout();
        if (!result.ok) {
          return send(res, 500, {
            error: { code: "logout_failed", message: result.message || "figmanage logout failed" },
          });
        }
        return send(res, 200, { ok: true });
      }

      send(res, 404, { error: { code: "not_found", message: "Not found" } });
    } catch (err: any) {
      send(res, 500, { error: { code: "figma_error", message: err.message } });
    }
  };
}
