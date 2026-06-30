import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { buildFrameBundle } from "../cloudflare/bundler";
import {
  deployViaWorker,
  normalizeProjectName,
} from "../cloudflare/deploy";
import { projectJsonPath } from "../paths";
import type { Project } from "../types";
import { track } from "../../src/lib/telemetry/server";
import type { ShareErrorKind } from "../../src/lib/telemetry/events";

export function classifyShareError(info: { code?: string; status: number }): ShareErrorKind {
  if (info.code === "invalid_key" || info.code === "missing_key" || info.status === 401) return "auth";
  if (info.code === "bundle_error") return "bundle_error";
  if (info.status >= 500) return "worker_5xx";
  if (info.status === 0) return "network";
  return "other";
}

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

export function cloudflareMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";

    const shareMatch = url.match(/^\/api\/projects\/([a-z0-9-]+)\/share$/);
    if (shareMatch && req.method === "POST") {
      const [, slug] = shareMatch;
      const shareStart = Date.now();

      try {
        const body = await readJson(req);
        const { frameSlug } = body;

        if (!frameSlug) {
          return send(res, 400, { error: { code: "missing_frame", message: "frameSlug required" } });
        }

        const settings = await readSettings();
        const shareKey = settings.cloudflare?.shareKey;

        if (!shareKey) {
          return send(res, 400, {
            error: {
              code: "no_share_key",
              message: "Studio share key must be configured in Settings",
            },
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

        // One Pages project PER FRAME, deployed to the production branch so
        // the canonical URL is the apex <project>.pages.dev — a single-label
        // host that Cloudflare's universal *.pages.dev cert covers instantly.
        //
        // The old scheme (one project per studio project, each frame a
        // *branch* deploy) produced a two-label host
        // (<frame>.<project>.pages.dev). The universal cert doesn't cover
        // that depth, so the URL's TLS handshake failed indefinitely; and the
        // apex stayed on Cloudflare's "Nothing is here yet" placeholder
        // because nothing was ever deployed to the production branch.
        //
        // Combining slug + frameSlug keeps each frame's project — and thus
        // its URL — stable across re-shares. normalizeProjectName enforces
        // Cloudflare's leading-digit ban and 58-char cap.
        const pagesProjectName = normalizeProjectName(`${slug}-${frameSlug}`);
        const branch = "main";

        const files = [
          { file: "index.html", data: bundle.html },
          { file: "assets/bundle.js", data: bundle.js },
          { file: "assets/bundle.css", data: bundle.css },
        ];
        if (bundle.liftXml) files.push({ file: `lift/${frameSlug}.xml`, data: bundle.liftXml });
        if (bundle.liftJson) files.push({ file: `lift/${frameSlug}.json`, data: bundle.liftJson });

        let deployment;
        try {
          deployment = await deployViaWorker({
            shareKey,
            pagesProjectName,
            branch,
            projectSlug: slug,
            files,
          });
        } catch (err: any) {
          // Surface the Worker's auth/validation errors as the same HTTP
          // status Studio's UI expects. Anything else (503, 5xx from the
          // Pages API) falls through to the generic 500 below.
          if (err.code === "invalid_key" || err.code === "missing_key") {
            track({ name: "share_failed", props: { duration_ms: Date.now() - shareStart, error_kind: "auth" } });
            return send(res, 401, {
              error: { code: err.code, message: err.message },
            });
          }
          throw err;
        }

        if (!projectJson.deployments) projectJson.deployments = [];

        projectJson.deployments.push({
          frameSlug,
          url: deployment.url,
          createdAt: new Date().toISOString(),
        });

        await fs.writeFile(projectPath, JSON.stringify(projectJson, null, 2));

        track({ name: "share_succeeded", props: { duration_ms: Date.now() - shareStart, frame_count: projectJson.frames?.length ?? 0 } });
        return send(res, 200, { url: deployment.url, deployId: deployment.deployId });
      } catch (err: any) {
        console.error("[cloudflare] Share failed:", err);
        track({ name: "share_failed", props: { duration_ms: Date.now() - shareStart, error_kind: classifyShareError({ code: err?.code, status: 500 }) } });
        return send(res, 500, {
          error: { code: "deploy_failed", message: err.message },
        });
      }
    }

    next?.();
  };
}
