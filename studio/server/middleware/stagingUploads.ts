import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { stagingRoot, stagingSessionDir } from "../paths";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const COOKIE_NAME = "studio_staging_session";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("=")) || null;
  }
  return null;
}

function newSessionId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function stagingUploadsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    if (req.url !== "/api/uploads/_staging" || req.method !== "POST") return next?.();

    const ct = req.headers["content-type"] ?? "";
    const extMatch = /image\/(png|jpeg|webp|gif)/.exec(ct);
    if (!extMatch) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Unsupported image type" } }));
      return;
    }

    const existing = parseCookie(req.headers.cookie, COOKIE_NAME);
    const sessionId = existing ?? newSessionId();

    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    try {
      for await (const c of req) {
        total += c.length;
        if (total > MAX_UPLOAD_BYTES) { tooLarge = true; break; }
        chunks.push(Buffer.from(c));
      }
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: err?.message ?? "upload failed" } }));
      return;
    }

    if (tooLarge) {
      req.on("error", () => {});
      req.resume();
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Image too large (max 10MB)" } }));
      return;
    }

    try {
      const dir = stagingSessionDir(sessionId);
      await fs.mkdir(dir, { recursive: true });
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extMatch[1]}`;
      const abs = path.join(dir, name);
      await fs.writeFile(abs, Buffer.concat(chunks));
      const headers: Record<string, string | string[]> = { "Content-Type": "application/json" };
      if (!existing) {
        headers["Set-Cookie"] =
          `${COOKIE_NAME}=${sessionId}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; HttpOnly`;
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify({ path: abs, url: `/@fs${abs}` }));
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: err?.message ?? "upload failed" } }));
    }
  };
}

/** Delete any staging session folders older than `maxAgeMs`. Silent on error. */
export async function cleanStaleStagingSessions(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
  try {
    const root = stagingRoot();
    const entries = await fs.readdir(root, { withFileTypes: true });
    const cutoff = Date.now() - maxAgeMs;
    await Promise.all(entries.map(async (e) => {
      if (!e.isDirectory()) return;
      const abs = path.join(root, e.name);
      const stat = await fs.stat(abs).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) {
        await fs.rm(abs, { recursive: true, force: true }).catch(() => {});
      }
    }));
  } catch {
    // root may not exist yet — that's fine
  }
}
