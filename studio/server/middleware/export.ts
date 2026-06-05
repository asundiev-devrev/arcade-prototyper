// studio/server/middleware/export.ts
//
// Saves and serves a per-frame SLJ JSON file (Figma Export Slice 0). Mirrors
// the read-only liftMiddleware, but adds a POST that the export pipeline calls
// to persist the computed SLJ next to each frame. Routes:
//
//   GET  /api/projects/:slug/export/:frame.slj.json  → serve the stored SLJ
//   POST /api/projects/:slug/export/:frame.slj.json  → store a SLJ for the frame
//
// File lives at frameDir(slug, frame)/SLJ.json — alongside LIFT.xml/LIFT.json.

import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../paths";

const ROUTE = /^\/api\/projects\/([a-z0-9-]+)\/export\/([a-z0-9-]+)\.slj\.json(?:\?.*)?$/;
const FILENAME = "SLJ.json";
const JSON_TYPE = "application/json; charset=utf-8";
const MAX_BYTES = 8 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: string, contentType = JSON_TYPE) {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

export function exportMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const m = (req.url ?? "/").match(ROUTE);
    if (!m) return next?.();
    const [, slug, frame] = m;
    const file = path.join(frameDir(slug, frame), FILENAME);

    if (req.method === "GET") {
      try {
        const body = await fs.readFile(file, "utf-8");
        return send(res, 200, body);
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return send(res, 404, JSON.stringify({ error: { code: "not_found", message: "SLJ not found" } }));
        }
        return send(res, 500, JSON.stringify({ error: { code: "read_failed", message: err.message } }));
      }
    }

    if (req.method === "POST") {
      // Read the body with a hard size cap before touching disk. On overflow we
      // send 413 then drain the rest of the stream (without retaining chunks) so
      // the socket can close cleanly — destroying mid-response causes
      // ECONNRESET on the client side. Mirrors uploadsMiddleware.
      const chunks: Buffer[] = [];
      let total = 0;
      let tooLarge = false;
      try {
        for await (const c of req) {
          total += c.length;
          if (total > MAX_BYTES) {
            tooLarge = true;
            break;
          }
          chunks.push(Buffer.from(c));
        }
      } catch (err: any) {
        return send(res, 500, JSON.stringify({ error: { code: "read_failed", message: err?.message ?? "read failed" } }));
      }

      if (tooLarge) {
        req.on("error", () => {});
        req.resume();
        return send(res, 413, JSON.stringify({ error: { code: "too_large", message: "SLJ too large" } }));
      }

      const raw = Buffer.concat(chunks).toString("utf-8");
      try {
        JSON.parse(raw); // validate it's JSON before persisting
      } catch {
        return send(res, 400, JSON.stringify({ error: { code: "bad_json", message: "Body is not valid JSON" } }));
      }
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, raw, "utf-8");
        return send(res, 200, JSON.stringify({ ok: true }));
      } catch (err: any) {
        return send(res, 500, JSON.stringify({ error: { code: "write_failed", message: err.message } }));
      }
    }

    return next?.();
  };
}
