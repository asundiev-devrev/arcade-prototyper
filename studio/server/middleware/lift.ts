// studio/server/middleware/lift.ts
//
// Serves LIFT.xml and LIFT.json that liftEmitPlugin writes next to each
// frame. Read-only; the plugin is the source of truth. Routes:
//
//   GET /api/projects/:slug/lift/:frame.xml
//   GET /api/projects/:slug/lift/:frame.json

import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../paths";

function send(res: ServerResponse, status: number, body: string, contentType: string) {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

const CONTENT_TYPES: Record<string, string> = {
  xml: "application/xml; charset=utf-8",
  json: "application/json; charset=utf-8",
};

const FILENAMES: Record<string, string> = {
  xml: "LIFT.xml",
  json: "LIFT.json",
};

export function liftMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    const m = url.match(/^\/api\/projects\/([a-z0-9-]+)\/lift\/([a-z0-9-]+)\.(xml|json)(?:\?.*)?$/);
    if (!m || req.method !== "GET") return next?.();

    const [, slug, frame, ext] = m;
    const file = path.join(frameDir(slug, frame), FILENAMES[ext]);
    try {
      const body = await fs.readFile(file, "utf-8");
      return send(res, 200, body, CONTENT_TYPES[ext]);
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
