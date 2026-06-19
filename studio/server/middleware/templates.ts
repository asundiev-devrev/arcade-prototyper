import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { TEMPLATES, getTemplate, TEMPLATE_THUMBS_DIR } from "../templates";

export function templatesMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = (req.url ?? "/").replace(/\?.*$/, "");
    if (!url.startsWith("/api/templates")) return next?.();

    if (req.method === "GET" && url === "/api/templates") {
      const list = TEMPLATES.map(({ id, name, description }) => ({ id, name, description }));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(list));
    }

    const thumbMatch = url.match(/^\/api\/templates\/([a-z0-9-]+)\/thumb$/);
    if (req.method === "GET" && thumbMatch) {
      const def = getTemplate(thumbMatch[1]);
      if (!def) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { code: "not_found", message: "Unknown template" } }));
      }
      try {
        const png = await fs.readFile(path.join(TEMPLATE_THUMBS_DIR, def.thumb));
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
        return res.end(png);
      } catch {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { code: "not_found", message: "Thumbnail not built" } }));
      }
    }

    return next?.();
  };
}
