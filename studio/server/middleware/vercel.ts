import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { buildFrameBundle } from "../vercel/bundler";
import { deployToVercel, validateVercelToken } from "../vercel/deploy";
import { projectDir, projectJsonPath } from "../paths";
import type { Project } from "../types";

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = "";
  for await (const chunk of req) buf += chunk;
  return buf ? JSON.parse(buf) : {};
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readSettings(): Promise<any> {
  const { studioRoot } = await import("../paths");
  const file = path.join(studioRoot(), "settings.json");
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function vercelMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";

    const shareMatch = url.match(/^\/api\/projects\/([a-z0-9-]+)\/share$/);
    if (shareMatch && req.method === "POST") {
      const [, slug] = shareMatch;

      try {
        const body = await readJson(req);
        const { frameSlug } = body;

        if (!frameSlug) {
          return send(res, 400, { error: { code: "missing_frame", message: "frameSlug required" } });
        }

        const settings = await readSettings();
        const vercelToken = settings.vercel?.token;

        if (!vercelToken) {
          return send(res, 400, {
            error: { code: "no_token", message: "Vercel token not configured in settings" },
          });
        }

        const tokenValid = await validateVercelToken(vercelToken);
        if (!tokenValid) {
          return send(res, 401, {
            error: { code: "invalid_token", message: "Vercel token is invalid" },
          });
        }

        const projectPath = projectJsonPath(slug);
        const projectJson: Project = JSON.parse(await fs.readFile(projectPath, "utf-8"));

        const frame = projectJson.frames.find(f => f.slug === frameSlug);
        if (!frame) {
          return send(res, 404, { error: { code: "frame_not_found", message: "Frame not found" } });
        }

        const { frameDir } = await import("../paths");
        const framePath = frameDir(slug, frameSlug);

        const bundle = await buildFrameBundle({
          projectSlug: slug,
          frameSlug,
          framePath,
          theme: projectJson.theme,
          mode: projectJson.mode,
        });

        const deployment = await deployToVercel({
          name: `arcade-${slug}-${frameSlug}`,
          files: [
            { file: "index.html", data: Buffer.from(bundle.html).toString("base64") },
          ],
          token: vercelToken,
          teamId: settings.vercel?.teamId,
        });

        if (!projectJson.deployments) {
          projectJson.deployments = [];
        }

        projectJson.deployments.push({
          frameSlug,
          url: deployment.url,
          createdAt: new Date().toISOString(),
        });

        await fs.writeFile(projectPath, JSON.stringify(projectJson, null, 2));

        return send(res, 200, { url: `https://${deployment.url}`, deployId: deployment.id });
      } catch (err: any) {
        console.error("[vercel] Share failed:", err);
        return send(res, 500, {
          error: { code: "deploy_failed", message: err.message },
        });
      }
    }

    next?.();
  };
}
