import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { writeBatch, type VisualEditRequest } from "../codeWriter/index";
import { moveSibling } from "../codeWriter/reorder";
import { frameDir } from "../paths";
import { pushSnapshot } from "../editHistory";

async function readJson(req: IncomingMessage): Promise<unknown> {
  let buf = "";
  for await (const chunk of req) buf += chunk;
  if (!buf) return {};
  try { return JSON.parse(buf); } catch { return {}; }
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * POST /api/visual-edit/:slug — apply a batch of deterministic element edits
 * directly to the frame source. Returns { ok:true } on success or
 * { ok:false, reason } when the change can't be mapped (client then falls back
 * to the chat path). HTTP 200 either way; 400 only for malformed input.
 */
export function visualEditMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "";
    if (req.method !== "POST" || !url.startsWith("/api/visual-edit/")) return next?.();

    const body = (await readJson(req)) as Partial<VisualEditRequest> & { move?: { file: string; line: number; column: number; dir: "up" | "down" } };

    // Handle move operations first
    const move = body.move;
    if (typeof body.frameSlug === "string" && move) {
      try {
        const result = await moveSibling(body.frameSlug, move.file, move.line, move.column, move.dir);
        return send(res, 200, result);
      } catch (err) {
        console.warn("[visualEdit] moveSibling threw:", err);
        return send(res, 200, { ok: false, reason: "move-threw" });
      }
    }

    // Handle batch edit operations
    if (typeof body.frameSlug !== "string" || !Array.isArray(body.edits) || body.edits.length === 0) {
      return send(res, 400, { ok: false, reason: "bad_request" });
    }

    const slug = url.slice("/api/visual-edit/".length);

    // Snapshot the pre-write source for one-step undo, then write.
    try {
      const file = path.join(frameDir(slug, body.frameSlug), "index.tsx");
      const before = await fs.readFile(file, "utf-8");
      const result = await writeBatch(body.frameSlug, body.edits);
      if (result.ok) pushSnapshot(slug, body.frameSlug, before);
      send(res, 200, result);
    } catch (err) {
      send(res, 200, { ok: false, reason: "writer-threw" });
      console.warn("[visualEdit] writeBatch threw:", err);
    }
  };
}
