import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import { createProject, deleteProject, listProjects, renameProject, updateProject, getProject, readHistory, fileTree, readProjectFile } from "../projects";
import { frameDir } from "../paths";

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = "";
  for await (const chunk of req) buf += chunk;
  return buf ? JSON.parse(buf) : {};
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

export function projectsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    if (!url.startsWith("/api/projects")) return next?.();
    try {
      const histMatch = url.match(/^\/api\/projects\/([a-z0-9-]+)\/history$/);
      if (req.method === "GET" && histMatch) {
        return send(res, 200, await readHistory(histMatch[1]));
      }

      const treeMatch = url
        .replace(/\?.*$/, "")
        .match(/^\/api\/projects\/([a-z0-9-]+)\/tree$/);
      if (treeMatch && req.method === "GET") {
        return send(res, 200, await fileTree(treeMatch[1]));
      }

      const fileMatch = url.match(/^\/api\/projects\/([a-z0-9-]+)\/file(?:\?path=(.+))?$/);
      if (fileMatch && req.method === "GET") {
        const relPath = fileMatch[2];
        if (!relPath) {
          return send(res, 400, { error: { code: "bad_request", message: "path query param required" } });
        }
        return send(res, 200, {
          content: await readProjectFile(fileMatch[1], decodeURIComponent(relPath)),
        });
      }

      const revealMatch = url
        .replace(/\?.*$/, "")
        .match(/^\/api\/projects\/([a-z0-9-]+)\/reveal$/);
      if (revealMatch && req.method === "POST") {
        const p = await getProject(revealMatch[1]);
        if (!p) return send(res, 404, { error: { code: "not_found", message: "Project not found" } });
        const { projectDir } = await import("../paths");
        const { spawn } = await import("node:child_process");

        let opener: string | null = null;
        if (process.platform === "darwin") opener = "open";
        else if (process.platform === "linux") opener = "xdg-open";
        else if (process.platform === "win32") opener = "explorer";

        if (!opener) {
          return send(res, 501, {
            error: { code: "not_supported", message: `Reveal not supported on ${process.platform}` },
          });
        }

        try {
          spawn(opener, [projectDir(revealMatch[1])], { detached: true }).unref();
        } catch (err: any) {
          return send(res, 500, {
            error: { code: "reveal_failed", message: err?.message ?? "reveal failed" },
          });
        }
        return send(res, 204);
      }

      const frameMatch = url
        .replace(/\?.*$/, "")
        .match(/^\/api\/projects\/([a-z0-9-]+)\/frames\/([a-z0-9-]+)$/);
      if (frameMatch && req.method === "PATCH") {
        const body = await readJson(req);
        const p = await getProject(frameMatch[1]);
        if (!p) return send(res, 404, { error: { code: "not_found", message: "Project not found" } });
        if (!p.frames.some((f) => f.slug === frameMatch[2])) {
          return send(res, 404, { error: { code: "not_found", message: "Frame not found" } });
        }
        const allowed = ["name", "size"] as const;
        const patch: Record<string, unknown> = {};
        for (const k of allowed) {
          if (k in body) patch[k] = body[k];
        }
        const frames = p.frames.map((f) => (f.slug === frameMatch[2] ? { ...f, ...patch } : f));
        return send(res, 200, await updateProject(frameMatch[1], { frames }));
      }
      if (frameMatch && req.method === "DELETE") {
        const p = await getProject(frameMatch[1]);
        if (!p) return send(res, 404, { error: { code: "not_found", message: "Project not found" } });
        if (!p.frames.some((f) => f.slug === frameMatch[2])) {
          return send(res, 404, { error: { code: "not_found", message: "Frame not found" } });
        }
        await fs.rm(frameDir(frameMatch[1], frameMatch[2]), { recursive: true, force: true });
        const next = await updateProject(frameMatch[1], {
          frames: p.frames.filter((f) => f.slug !== frameMatch[2]),
        });
        return send(res, 200, next);
      }

      const parts = url.replace(/\?.*$/, "").split("/").filter(Boolean); // ["api","projects",slug?]
      const slug = parts[2];

      if (req.method === "GET" && !slug) return send(res, 200, await listProjects());
      if (req.method === "GET" && slug)  {
        const p = await getProject(slug);
        return send(res, p ? 200 : 404, p ?? { error: { code: "not_found", message: "Project not found" } });
      }
      if (req.method === "POST" && !slug) {
        const body = await readJson(req);
        return send(res, 201, await createProject(body));
      }
      if (req.method === "PATCH" && slug) {
        const body = await readJson(req);
        if (typeof body.name === "string") return send(res, 200, await renameProject(slug, body.name));
        return send(res, 200, await updateProject(slug, body));
      }
      if (req.method === "DELETE" && slug) {
        await deleteProject(slug);
        return send(res, 204);
      }
      send(res, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } });
    } catch (err: any) {
      send(res, 400, { error: { code: "bad_request", message: err.message } });
    }
  };
}
