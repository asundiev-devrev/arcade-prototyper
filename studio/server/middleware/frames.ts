import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { getProject, nextFramePrefix, reconcileFrames } from "../projects";
import { projectDir } from "../paths";

const ROUTE = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/frames$/;

const BLANK_FRAME_SCAFFOLD = `export default function UntitledFrame() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center text-[var(--fg-neutral-subtle)]">
        This frame is blank. Describe it in the chat to bring it to life.
      </div>
    </div>
  );
}
`;

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function nextUntitledNumber(existingSlugs: string[]): number {
  const used = new Set(
    existingSlugs
      .map((s) => s.match(/^\d+-untitled-(\d+)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => Number(m[1])),
  );
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

export function framesMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = (req.url ?? "").replace(/\?.*$/, "");
    const match = url.match(ROUTE);
    if (!match || req.method !== "POST") return next?.();

    const slug = match[1];
    try {
      const project = await getProject(slug);
      if (!project) {
        return send(res, 404, { error: { code: "not_found", message: "Project not found" } });
      }

      // Frames actually on disk may include ones not yet reconciled into
      // project.frames; scan the directory directly so prefix selection and
      // untitled numbering see the true set.
      const framesDir = path.join(projectDir(slug), "frames");
      let onDisk: string[] = [];
      try {
        onDisk = await fs.readdir(framesDir);
      } catch {
        onDisk = [];
      }

      const prefix = nextFramePrefix(onDisk);
      const n = nextUntitledNumber(onDisk);
      const newSlug = `${prefix}-untitled-${n}`;
      const dir = path.join(framesDir, newSlug);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "index.tsx"), BLANK_FRAME_SCAFFOLD);

      const frames = await reconcileFrames(slug);
      const created = frames.find((f) => f.slug === newSlug);
      if (!created) {
        return send(res, 500, {
          error: { code: "reconcile_failed", message: "Frame was written but not reconciled" },
        });
      }
      send(res, 201, created);
    } catch (err: any) {
      send(res, 500, { error: { code: "internal", message: err?.message ?? String(err) } });
    }
  };
}
