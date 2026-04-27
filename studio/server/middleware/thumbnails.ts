import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import { frameThumbnailPath } from "../paths";
import { captureFrameThumbnail } from "../thumbnails/capture";

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

export function thumbnailsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";

    // GET /api/projects/:slug/thumbnails/:frame
    const getMatch = url.match(/^\/api\/projects\/([a-z0-9-]+)\/thumbnails\/([a-z0-9-]+)\.png$/);
    if (getMatch && req.method === "GET") {
      const [, projectSlug, frameSlug] = getMatch;
      const thumbnailPath = frameThumbnailPath(projectSlug, frameSlug);

      try {
        const data = await fs.readFile(thumbnailPath);
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=3600",
        });
        res.end(data);
        return;
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return send(res, 404, { error: { code: "not_found", message: "Thumbnail not found" } });
        }
        return send(res, 500, { error: { code: "read_failed", message: err.message } });
      }
    }

    // POST /api/projects/:slug/thumbnails/:frame/capture
    const captureMatch = url.match(/^\/api\/projects\/([a-z0-9-]+)\/thumbnails\/([a-z0-9-]+)\/capture$/);
    if (captureMatch && req.method === "POST") {
      const [, projectSlug, frameSlug] = captureMatch;

      try {
        const result = await captureFrameThumbnail(projectSlug, frameSlug);
        if (result) {
          return send(res, 200, { path: result });
        } else {
          return send(res, 500, { error: { code: "capture_failed", message: "Capture failed" } });
        }
      } catch (err: any) {
        return send(res, 500, { error: { code: "capture_failed", message: err.message } });
      }
    }

    return next?.();
  };
}
