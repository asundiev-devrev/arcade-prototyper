import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { figmaWhoami, getNode, nodeTree, exportNodePng, figmaLoginStream } from "../figmaCli";
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

      // SSE endpoint: spawn `figmanage login`, stream stdout lines, close on exit.
      // This branch has its own try/catch because once the 200 SSE headers are
      // flushed the outer handler cannot safely send a 500 JSON response.
      if (req.method === "POST" && url === "/api/figma/auth/login") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        // Writes that happen after the client disconnected throw EPIPE; guard
        // every write so a disconnect never surfaces as a crash.
        const writeFrame = (frame: unknown) => {
          if (res.writableEnded || res.destroyed) return;
          try { res.write(`data: ${JSON.stringify(frame)}\n\n`); } catch { /* peer gone */ }
        };
        const handle = figmaLoginStream((line) => writeFrame({ kind: "line", line }));
        req.on("close", () => handle.stop());
        try {
          const result = await handle.done;
          writeFrame({ kind: "end", ...result });
        } catch (err: any) {
          writeFrame({ kind: "end", ok: false, code: 1, error: err?.message ?? String(err) });
        } finally {
          if (!res.writableEnded) res.end();
        }
        return;
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
