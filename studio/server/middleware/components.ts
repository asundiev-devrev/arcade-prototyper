import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { userKitCompositesDir, userKitDir } from "../paths";
import {
  listComponents, saveComponentFile,
  componentExists, isValidComponentName, ComponentCompileError,
  componentThumbPath, saveComponentThumb,
} from "../componentStore";
import { buildExtractPrompt } from "../componentExtract";
import { packFromSource } from "../sidecar/packFromSource";
import { clearAllProjectSessions } from "../projects";

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = ""; for await (const c of req) buf += c; return buf ? JSON.parse(buf) : {};
}
async function readBinary(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}
function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

const HEADER_RE = /^\/\/\s*@arcade-component\s+name="([^"]+)"(?:\s+description="([^"]*)")?\s*$/m;

export function parseComponentFile(text: string): { name?: string; description?: string; tsx: string } {
  const m = text.match(HEADER_RE);
  if (m) {
    return { name: m[1], description: m[2] ?? "", tsx: text.replace(HEADER_RE, "").replace(/^\n/, "") };
  }
  const fn = text.match(/export\s+(?:function|const)\s+([A-Z][A-Za-z0-9]*)/);
  return { name: fn?.[1], description: "", tsx: text };
}

function exportHeader(name: string, description: string): string {
  return `// @arcade-component name="${name}" description="${description.replace(/"/g, "'")}"\n`;
}

type ExtractionRunner = (args: {
  name: string; description: string; projectSlug: string; frameSlug: string; line: number; column: number;
}) => Promise<void>;

let extractionRunner: ExtractionRunner | null = null;
export function __setExtractionRunner(fn: ExtractionRunner | null) { extractionRunner = fn; }

async function defaultExtraction(args: Parameters<ExtractionRunner>[0]): Promise<void> {
  const { runClaudeTurnWithRetry } = await import("../claudeCode");
  const { resolveClaudeBin } = await import("../claudeBin");
  const { projectDir } = await import("../paths");
  const outPath = path.join(userKitCompositesDir(), `${args.name}.tsx`);
  await runClaudeTurnWithRetry({
    cwd: projectDir(args.projectSlug),
    prompt: buildExtractPrompt({
      name: args.name, description: args.description,
      frameSlug: args.frameSlug, line: args.line, column: args.column,
      outPath,
    }),
    bin: resolveClaudeBin(),
    addDirs: [userKitDir()],
    onEvent: () => {},
    onCrash: () => {},
  });
}

export async function handleSaveForTest(input: {
  projectSlug: string; frameSlug: string; line: number; column: number;
  name: string; description: string; replace?: boolean;
}): Promise<{ status: number; body: unknown }> {
  if (!isValidComponentName(input.name)) return { status: 400, body: { error: { code: "bad_name" } } };
  if (await componentExists(input.name) && !input.replace) {
    return { status: 409, body: { error: { code: "name_taken" }, name: input.name } };
  }
  const run = extractionRunner ?? defaultExtraction;
  await run(input);
  const filePath = path.join(userKitCompositesDir(), `${input.name}.tsx`);
  let tsx: string;
  try { tsx = await fs.readFile(filePath, "utf-8"); }
  catch { return { status: 422, body: { error: { code: "extract_failed", message: "Couldn't turn this into a clean component — try a different element." } } }; }
  try {
    await saveComponentFile({ name: input.name, description: input.description, tsx, origin: "saved", createdAt: new Date().toISOString() });
  } catch (err) {
    if (err instanceof ComponentCompileError) {
      await fs.rm(filePath, { force: true });
      return { status: 422, body: { error: { code: "extract_failed", message: "Couldn't turn this into a clean component — try a different element." } } };
    }
    throw err;
  }
  // The kit catalog rides in the cached system prompt; clear resume sessions so
  // the next turn sees the new component instead of resuming a stale prompt.
  await clearAllProjectSessions().catch(() => {});
  return { status: 200, body: { saved: true, name: input.name } };
}

export function componentsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = (req.url ?? "").replace(/\?.*$/, "");
    if (!url.startsWith("/api/components")) return next?.();

    if (url === "/api/components" && req.method === "GET") {
      return send(res, 200, { components: await listComponents() });
    }

    const exportMatch = url.match(/^\/api\/components\/([A-Za-z][A-Za-z0-9]*)\/export$/);
    if (exportMatch && req.method === "GET") {
      const name = exportMatch[1];
      if (!(await componentExists(name))) return send(res, 404, { error: { code: "not_found" } });
      const tsx = await fs.readFile(path.join(userKitCompositesDir(), `${name}.tsx`), "utf-8");
      const meta = (await listComponents()).find((c) => c.name === name);
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.arcade.tsx"`,
      });
      res.end(exportHeader(name, meta?.description ?? "") + tsx);
      return;
    }

    if (url === "/api/components/import" && req.method === "POST") {
      const body = await readJson(req);
      const text = typeof body?.tsx === "string" ? body.tsx : "";
      const parsed = parseComponentFile(text);
      if (!parsed.name || !isValidComponentName(parsed.name)) {
        return send(res, 422, { error: { code: "bad_component", message: "This doesn't look like an exported component." } });
      }
      if (await componentExists(parsed.name) && !body?.replace) {
        return send(res, 409, { error: { code: "name_taken", message: `You already have a component named ${parsed.name}.` }, name: parsed.name });
      }
      try {
        await saveComponentFile({
          name: parsed.name, description: parsed.description ?? "", tsx: parsed.tsx,
          origin: "imported", createdAt: new Date().toISOString(),
        });
      } catch (err) {
        if (err instanceof ComponentCompileError) {
          return send(res, 422, { error: { code: "compile_failed", message: "This doesn't look like an exported component." } });
        }
        throw err;
      }
      await clearAllProjectSessions().catch(() => {});
      return send(res, 200, { imported: true, name: parsed.name });
    }

    // Rendered HTML for a component — used as the source for the client-side
    // thumbnail capture (and as a live preview). Reuses the shipped esbuild +
    // Tailwind bundler (packFromSource), so it works in the packaged DMG.
    const previewMatch = url.match(/^\/api\/components\/([A-Za-z][A-Za-z0-9]*)\/preview$/);
    if (previewMatch && req.method === "GET") {
      const name = previewMatch[1];
      if (!(await componentExists(name))) return send(res, 404, { error: { code: "not_found" } });
      const tsx = await fs.readFile(path.join(userKitCompositesDir(), `${name}.tsx`), "utf-8");
      // The stored file exports the component as default; render it directly.
      try {
        const html = await packFromSource({ tsx });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        return send(res, 422, { error: { code: "preview_failed" } });
      }
      return;
    }

    const thumbMatch = url.match(/^\/api\/components\/([A-Za-z][A-Za-z0-9]*)\/thumb$/);
    if (thumbMatch && req.method === "GET") {
      const name = thumbMatch[1];
      try {
        const buf = await fs.readFile(componentThumbPath(name));
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
        res.end(buf);
      } catch {
        return send(res, 404, { error: { code: "thumb_not_found" } });
      }
      return;
    }
    if (thumbMatch && req.method === "POST") {
      const name = thumbMatch[1];
      if (!(await componentExists(name))) return send(res, 404, { error: { code: "not_found" } });
      const png = await readBinary(req);
      // Cheap PNG magic-byte guard so a stray body can't poison the cache.
      if (png.length < 8 || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) {
        return send(res, 422, { error: { code: "not_png" } });
      }
      await saveComponentThumb(name, png);
      return send(res, 200, { thumb: true });
    }

    const delMatch = url.match(/^\/api\/components\/([A-Za-z][A-Za-z0-9]*)$/);
    if (delMatch && req.method === "DELETE") {
      // Rewrite-first deletion: if frames use this component, strip it from
      // them in the background before removing the file, so none go blank.
      const { deleteComponentAndRewriteFrames } = await import("../componentDeletion");
      const result = await deleteComponentAndRewriteFrames(delMatch[1]);
      return send(res, 200, {
        deleted: result.status === "deleted",
        rewriting: result.status === "rewriting",
        frames: result.frames.map((f) => ({ slug: f.slug, frame: f.frameSlug })),
      });
    }

    if (url === "/api/components/save" && req.method === "POST") {
      const b = await readJson(req);
      const r = await handleSaveForTest({
        projectSlug: String(b.projectSlug), frameSlug: String(b.frameSlug),
        line: Number(b.line), column: Number(b.column),
        name: String(b.name), description: String(b.description ?? ""), replace: !!b.replace,
      });
      return send(res, r.status, r.body);
    }

    return next?.();
  };
}
