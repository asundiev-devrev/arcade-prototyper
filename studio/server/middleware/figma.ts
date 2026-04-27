import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { daemonStatus, getNode, nodeTree, exportNodePng } from "../figmaCli";
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
        const s = await daemonStatus();
        if (!s.connected) {
          return send(res, 503, { error: { code: "figma_disconnected", message: "Figma Desktop is not connected", hint: "Open Figma Desktop and try again." } });
        }
        return send(res, 200, s);
      }
      const nodeMatch = url.match(/^\/api\/figma\/node\/([^?/]+)(?:\?.*)?$/);
      if (req.method === "GET" && nodeMatch) {
        return send(res, 200, await getNode(decodeURIComponent(nodeMatch[1])));
      }
      const treeMatch = url.match(/^\/api\/figma\/tree\/([^?/]+)(?:\?d=(\d+))?/);
      if (req.method === "GET" && treeMatch) {
        return send(res, 200, await nodeTree(decodeURIComponent(treeMatch[1]), Number(treeMatch[2] ?? 3)));
      }
      if (req.method === "POST" && url.startsWith("/api/figma/export")) {
        let buf = ""; for await (const c of req) buf += c;
        let parsed: { nodeId: string; outFile: string; scale?: number };
        try {
          parsed = JSON.parse(buf);
        } catch {
          return send(res, 400, { error: { code: "bad_request", message: "Invalid JSON body" } });
        }
        const { nodeId, outFile, scale } = parsed;
        const resolved = path.resolve(outFile);
        if (!isInsideProjectsRoot(resolved)) {
          return send(res, 400, { error: { code: "invalid_path", message: "outFile must be within the projects root" } });
        }
        const out = await exportNodePng(nodeId, resolved, scale);
        return send(res, 200, { path: out });
      }
      send(res, 404, { error: { code: "not_found", message: "Not found" } });
    } catch (err: any) {
      send(res, 500, { error: { code: "figma_error", message: err.message } });
    }
  };
}
