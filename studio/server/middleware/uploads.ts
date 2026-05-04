import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { projectDir } from "../paths";
import { getProject } from "../projects";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function uploadsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    // URL regex mirrors the canonical slug pattern from paths.ts::SLUG so
    // that slugs we cannot validate pass through to next() instead of 500ing
    // inside projectDir().
    const m = req.url?.match(/^\/api\/uploads\/([a-z0-9][a-z0-9-]{0,62})$/i);
    if (!m || req.method !== "POST") return next?.();
    const slug = m[1];

    const ct = req.headers["content-type"] ?? "";
    const baseType = ct.split(";")[0].trim().toLowerCase();
    const extMatch = /^image\/(png|jpeg|webp|gif)$/.exec(baseType);
    if (!extMatch) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Unsupported image type" } }));
      return;
    }

    const project = await getProject(slug);
    if (!project) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Project not found" } }));
      return;
    }

    // Read the body up-front with a hard size cap so a malicious client cannot
    // OOM the server with an unbounded stream. We cap before any file is
    // written to disk. When the cap trips we send 413 and then drain the rest
    // of the request stream (without retaining chunks) so the socket can close
    // cleanly — destroying mid-response causes ECONNRESET on the client side.
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    try {
      for await (const c of req) {
        total += c.length;
        if (total > MAX_UPLOAD_BYTES) {
          tooLarge = true;
          break;
        }
        chunks.push(Buffer.from(c));
      }
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: err?.message ?? "upload failed" } }));
      return;
    }

    if (tooLarge) {
      // `for await` on a paused stream does not auto-resume on exit; call
      // resume() so any pending chunks are flushed and the request can end.
      req.on("error", () => {});
      req.resume();
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Image too large (max 10MB)" } }));
      return;
    }

    try {
      const dir = path.join(projectDir(slug), "_uploads");
      await fs.mkdir(dir, { recursive: true });
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extMatch[1]}`;
      const abs = path.join(dir, name);
      await fs.writeFile(abs, Buffer.concat(chunks));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: abs, url: `/@fs${abs}` }));
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: err?.message ?? "upload failed" } }));
    }
  };
}
