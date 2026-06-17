import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This middleware file lives at:
//   <repo>/studio/server/middleware/assets.ts                       (dev)
//   <App>/Contents/Resources/app/studio/server/middleware/assets.ts (packaged)
// Two "../" from server/middleware/ resolves to studio/, so prototype-kit/
// is reachable identically in dev and in the packaged app (electron-builder's
// `studio/**` glob copies prototype-kit verbatim). Mirrors version.ts.
const MW_DIR = path.dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = path.resolve(MW_DIR, "..", "..", "prototype-kit");
const CATALOG = path.join(KIT_ROOT, "assets-catalog.json");
const THUMBS = path.join(KIT_ROOT, "assets-thumbs");

// Asset names are alphanumeric, leading letter — never a path separator.
// This is the path-traversal defense: a "/" or ".." in the URL cannot match,
// so it falls through to next() and can never read outside THUMBS.
const THUMB_ROUTE = /^\/api\/assets\/thumbs\/([A-Za-z][A-Za-z0-9]*)\.png$/;

export function assetsMiddleware() {
  return function (req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = req.url ?? "";
    if (req.method !== "GET") return next();

    if (url === "/api/assets") {
      fs.readFile(CATALOG, "utf-8")
        .then((json) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(json);
        })
        .catch(() => {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "catalog_unavailable" }));
        });
      return;
    }

    const thumbMatch = url.match(THUMB_ROUTE);
    if (thumbMatch) {
      const file = path.join(THUMBS, `${thumbMatch[1]}.png`);
      fs.readFile(file)
        .then((buf) => {
          res.writeHead(200, {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=3600",
          });
          res.end(buf);
        })
        .catch(() => {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "thumb_not_found" }));
        });
      return;
    }

    next();
  };
}
