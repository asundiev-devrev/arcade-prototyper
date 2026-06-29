import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../paths";
import { readInstanceAttrs } from "../codeWriter/instanceAttrs";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function instancePropsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const raw = req.url ?? "";
    if (req.method !== "GET" || !raw.startsWith("/api/instance-props/")) return next?.();
    try {
      const u = new URL(raw, "http://localhost");
      const slug = decodeURIComponent(u.pathname.slice("/api/instance-props/".length));
      const frame = u.searchParams.get("frame") ?? "";
      const line = Number(u.searchParams.get("line"));
      const col = Number(u.searchParams.get("col"));
      if (!SLUG_RE.test(slug) || !SLUG_RE.test(frame) || !Number.isFinite(line) || !Number.isFinite(col)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ attrs: {} }));
      }
      const file = path.join(frameDir(slug, frame), "index.tsx");
      const src = await fs.readFile(file, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ attrs: readInstanceAttrs(src, line, col) }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ attrs: {} }));
    }
  };
}
