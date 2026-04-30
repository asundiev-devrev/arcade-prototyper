import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { figmaWhoami, getNode, nodeTree, exportNodePng, figmaLoginWithPat } from "../figmaCli";
import { projectsRoot } from "../paths";

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function isInsideProjectsRoot(absPath: string): boolean {
  const root = projectsRoot();
  const rel = path.relative(root, absPath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function figmaMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    if (!url.startsWith("/api/figma")) return next?.();
    try {
      if (url === "/api/figma/status") {
        return send(res, 200, await figmaWhoami());
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

      // GET /api/figma/node/:fileKey/:nodeId
      const nodeMatch = url.match(/^\/api\/figma\/node\/([^/]+)\/([^?]+)(?:\?.*)?$/);
      if (req.method === "GET" && nodeMatch) {
        return send(res, 200, await getNode(decodeURIComponent(nodeMatch[1]), decodeURIComponent(nodeMatch[2])));
      }

      // GET /api/figma/tree/:fileKey/:nodeId?d=N
      const treeMatch = url.match(/^\/api\/figma\/tree\/([^/]+)\/([^?]+)(?:\?d=(\d+))?/);
      if (req.method === "GET" && treeMatch) {
        return send(
          res, 200,
          await nodeTree(
            decodeURIComponent(treeMatch[1]),
            decodeURIComponent(treeMatch[2]),
            Number(treeMatch[3] ?? 3),
          ),
        );
      }

      if (req.method === "POST" && url === "/api/figma/export") {
        let buf = ""; for await (const c of req) buf += c;
        let parsed: { fileKey?: string; nodeId?: string; outFile?: string; scale?: number };
        try { parsed = JSON.parse(buf); }
        catch {
          return send(res, 400, { error: { code: "bad_request", message: "Invalid JSON body" } });
        }
        const { fileKey, nodeId, outFile, scale } = parsed;
        if (!fileKey || !nodeId || !outFile) {
          return send(res, 400, { error: { code: "bad_request", message: "fileKey, nodeId, outFile required" } });
        }
        const resolved = path.resolve(outFile);
        if (!isInsideProjectsRoot(resolved)) {
          return send(res, 400, { error: { code: "invalid_path", message: "outFile must be within the projects root" } });
        }
        const out = await exportNodePng(fileKey, nodeId, resolved, scale);
        return send(res, 200, { path: out });
      }

      send(res, 404, { error: { code: "not_found", message: "Not found" } });
    } catch (err: any) {
      send(res, 500, { error: { code: "figma_error", message: err.message } });
    }
  };
}
