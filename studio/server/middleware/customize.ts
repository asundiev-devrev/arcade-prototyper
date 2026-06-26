// studio/server/middleware/customize.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../paths";
import { spliceComponentInSource } from "../customize/spliceComponent";
import { reconcileArcadeImports } from "../customize/imports";

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = ""; for await (const c of req) buf += c;
  if (!buf) return {};
  try { return JSON.parse(buf); } catch { return {}; }
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// One pre-Customize snapshot per "<slug>::<frameSlug>", for single-step Undo.
const undoSnapshots = new Map<string, string>();

function framePath(slug: string, frameSlug: string): { file: string; base: string } {
  const base = frameDir(slug, frameSlug);
  return { file: path.join(base, "index.tsx"), base };
}
function kitNamesIn(jsx: string): string[] {
  const set = new Set<string>();
  for (const m of jsx.matchAll(/<([A-Z]\w*)/g)) set.add(m[1]);
  return [...set];
}

export function customizeMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "";
    if (req.method !== "POST" || !url.startsWith("/api/customize/")) return next?.();

    // .../undo
    if (url.endsWith("/undo")) {
      const slug = url.slice("/api/customize/".length, -"/undo".length);
      const body = await readJson(req);
      const frameSlug = body?.frameSlug;
      if (typeof frameSlug !== "string") return send(res, 400, { ok: false, reason: "bad_request" });
      const key = `${slug}::${frameSlug}`;
      const snap = undoSnapshots.get(key);
      if (snap == null) return send(res, 200, { ok: false, reason: "nothing-to-undo" });
      try {
        const { file, base } = framePath(slug, frameSlug);
        if (!path.resolve(file).startsWith(path.resolve(base))) return send(res, 200, { ok: false, reason: "path-escape" });
        await fs.writeFile(file, snap, "utf-8");
        undoSnapshots.delete(key);
        return send(res, 200, { ok: true });
      } catch { return send(res, 200, { ok: false, reason: "undo-write-failed" }); }
    }

    const slug = url.slice("/api/customize/".length);
    const body = await readJson(req);
    const { frameSlug, targetComponentName, line, column, jsx } = body ?? {};
    if (typeof frameSlug !== "string" || typeof targetComponentName !== "string" ||
        typeof line !== "number" || typeof column !== "number" || typeof jsx !== "string") {
      return send(res, 400, { ok: false, reason: "bad_request" });
    }
    try {
      const { file, base } = framePath(slug, frameSlug);
      if (!path.resolve(file).startsWith(path.resolve(base))) return send(res, 200, { ok: false, reason: "path-escape" });
      const source = await fs.readFile(file, "utf-8");
      const spliced = spliceComponentInSource(source, targetComponentName, line, column, jsx);
      if (!spliced.ok) return send(res, 200, spliced);
      const withImports = reconcileArcadeImports(spliced.source, kitNamesIn(jsx));
      undoSnapshots.set(`${slug}::${frameSlug}`, source); // snapshot BEFORE write
      await fs.writeFile(file, withImports, "utf-8");
      return send(res, 200, { ok: true });
    } catch (err) {
      console.warn("[customize] failed:", err);
      return send(res, 200, { ok: false, reason: "customize-threw" });
    }
  };
}
