// studio/server/middleware/lift.ts
//
// Serves LIFT.md and LIFT.json that liftEmitPlugin writes next to each
// frame. Read-only; the plugin is the source of truth. Routes:
//
//   GET /api/projects/:slug/lift/:frame.md
//   GET /api/projects/:slug/lift/:frame.json

import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../paths";

function send(res: ServerResponse, status: number, body: string, contentType: string) {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

export function liftMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    const m = url.match(/^\/api\/projects\/([a-z0-9-]+)\/lift\/([a-z0-9-]+)\.(md|json)(?:\?.*)?$/);
    if (!m || req.method !== "GET") return next?.();

    const [, slug, frame, ext] = m;
    const file = path.join(frameDir(slug, frame), ext === "md" ? "LIFT.md" : "LIFT.json");
    try {
      const body = await fs.readFile(file, "utf-8");
      const contentType = ext === "md" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8";
      return send(res, 200, body, contentType);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return send(
          res,
          404,
          JSON.stringify({ error: { code: "not_found", message: "Manifest not found" } }),
          "application/json",
        );
      }
      return send(
        res,
        500,
        JSON.stringify({ error: { code: "read_failed", message: err.message } }),
        "application/json",
      );
    }
  };
}
