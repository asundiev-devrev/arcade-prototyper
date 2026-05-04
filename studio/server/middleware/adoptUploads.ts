import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
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
 * Reserves an unused destination path by open-exclusive (`wx`). On EEXIST we
 * bump a counter and retry. This closes the check-then-act race window that
 * a plain `fs.access`-loop would leave open to concurrent adoptions.
 */
async function reserveDest(destDir: string, base: string): Promise<string> {
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  // Cap the attempts so a pathological filename can't spin forever.
  for (let i = 0; i < 1000; i += 1) {
    const name = i === 0 ? base : `${stem}-${i}${ext}`;
    const candidate = path.join(destDir, name);
    try {
      const fh = await fs.open(candidate, "wx");
      await fh.close();
      return candidate;
    } catch (err: any) {
      if (err?.code === "EEXIST") continue;
      throw err;
    }
  }
  throw new Error(`Could not find a free destination filename for ${base}`);
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

  const destAbs = await reserveDest(destDir, path.basename(normalized));

  // `rename` overwrites the empty file we just reserved; we own the name by
  // holding it on disk from `reserveDest` until the rename completes.
  try {
    await fs.rename(normalized, destAbs);
  } catch (err: any) {
    if (err?.code !== "EXDEV") {
      // Rename failed for some non-cross-device reason; remove our reserved
      // placeholder so the dest dir doesn't accumulate empty files.
      await fs.unlink(destAbs).catch(() => {});
      throw err;
    }
    // Cross-device fallback: copy bytes with COPYFILE_EXCL would refuse to
    // overwrite our placeholder, so remove the placeholder first, then copy.
    // On copy success we surface unlink errors instead of swallowing them,
    // so a half-moved file doesn't look fully adopted.
    await fs.unlink(destAbs);
    await fs.copyFile(normalized, destAbs, fsConstants.COPYFILE_EXCL);
    try {
      await fs.unlink(normalized);
    } catch (unlinkErr) {
      // Roll the destination back so the caller treats this as failure and
      // the client won't reuse a path whose source still exists. Leaving
      // both sides present is the orphan-file mode we're trying to prevent.
      await fs.unlink(destAbs).catch(() => {});
      throw unlinkErr;
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
