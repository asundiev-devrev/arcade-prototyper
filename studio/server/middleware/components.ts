import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { userKitCompositesDir } from "../paths";
import {
  listComponents, saveComponentFile, deleteComponent,
  componentExists, isValidComponentName, ComponentCompileError,
} from "../componentStore";

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = ""; for await (const c of req) buf += c; return buf ? JSON.parse(buf) : {};
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
      return send(res, 200, { imported: true, name: parsed.name });
    }

    const delMatch = url.match(/^\/api\/components\/([A-Za-z][A-Za-z0-9]*)$/);
    if (delMatch && req.method === "DELETE") {
      await deleteComponent(delMatch[1]);
      return send(res, 200, { deleted: true });
    }

    return next?.();
  };
}
