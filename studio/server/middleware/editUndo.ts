// studio/server/middleware/editUndo.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../paths";
import { popSnapshot } from "../editHistory";

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = ""; for await (const c of req) buf += c;
  if (!buf) return {};
  try { return JSON.parse(buf); } catch { return {}; }
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function editUndoMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "";
    if (req.method !== "POST" || !url.startsWith("/api/edit-undo/")) return next?.();
    const slug = url.slice("/api/edit-undo/".length);
    const body = await readJson(req);
    const frameSlug = body?.frameSlug;
    if (typeof frameSlug !== "string") return send(res, 400, { ok: false, reason: "bad_request" });
    const snap = popSnapshot(slug, frameSlug);
    if (snap == null) return send(res, 200, { ok: false, reason: "nothing-to-undo" });
    try {
      const base = frameDir(slug, frameSlug);
      const file = path.join(base, "index.tsx");
      if (!path.resolve(file).startsWith(path.resolve(base))) return send(res, 200, { ok: false, reason: "path-escape" });
      await fs.writeFile(file, snap, "utf-8");
      return send(res, 200, { ok: true });
    } catch { return send(res, 200, { ok: false, reason: "undo-write-failed" }); }
  };
}
