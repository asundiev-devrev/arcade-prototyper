import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { projectDir, stagingRoot } from "../paths";
import { getProject } from "../projects";

const ROUTE = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/adopt-uploads$/i;

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = "";
  for await (const chunk of req) buf += chunk;
  return buf ? JSON.parse(buf) : {};
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

/**
 * Moves a staged upload into the project's _uploads/ folder.
 * Returns the destination path on success, or null if the source is missing
 * or escapes the staging root.
 */
async function adoptOne(srcAbs: string, projectSlug: string): Promise<string | null> {
  const root = stagingRoot();
  const normalized = path.resolve(srcAbs);
  if (!normalized.startsWith(root + path.sep)) return null;

  try {
    await fs.access(normalized);
  } catch {
    return null;
  }

  const destDir = path.join(projectDir(projectSlug), "_uploads");
  await fs.mkdir(destDir, { recursive: true });

  const base = path.basename(normalized);
  let destName = base;
  let counter = 1;
  while (true) {
    const candidate = path.join(destDir, destName);
    try {
      await fs.access(candidate);
      const ext = path.extname(base);
      const stem = base.slice(0, base.length - ext.length);
      destName = `${stem}-${counter}${ext}`;
      counter += 1;
    } catch {
      break;
    }
  }
  const destAbs = path.join(destDir, destName);

  try {
    await fs.rename(normalized, destAbs);
  } catch (err: any) {
    if (err?.code === "EXDEV") {
      await fs.copyFile(normalized, destAbs);
      await fs.unlink(normalized).catch(() => {});
    } else {
      throw err;
    }
  }
  return destAbs;
}

export function adoptUploadsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const m = req.url?.match(ROUTE);
    if (!m || req.method !== "POST") return next?.();
    const slug = m[1];

    const project = await getProject(slug);
    if (!project) return send(res, 404, { error: { message: "Project not found" } });

    let body: any;
    try { body = await readJson(req); }
    catch { return send(res, 400, { error: { message: "Invalid JSON" } }); }

    const paths: unknown = body?.paths;
    if (!Array.isArray(paths)) return send(res, 400, { error: { message: "paths must be an array" } });

    const mapping: Record<string, string> = {};
    const missing: string[] = [];

    for (const p of paths) {
      if (typeof p !== "string") { missing.push(String(p)); continue; }
      try {
        const dest = await adoptOne(p, slug);
        if (dest) mapping[p] = dest;
        else missing.push(p);
      } catch {
        missing.push(p);
      }
    }

    return send(res, 200, { mapping, missing });
  };
}
