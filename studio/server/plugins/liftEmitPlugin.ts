// studio/server/plugins/liftEmitPlugin.ts
//
// Watches each project's frames directory. Whenever a frame's index.tsx
// changes, regenerate LIFT.md and LIFT.json next to it.
//
// We piggyback on chokidar directly (same pattern as projectWatchPlugin).
// The actual regeneration is an exported async function so tests can
// invoke it without a real Vite server.

import type { Plugin } from "vite";
import chokidar from "chokidar";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir, projectsRoot, chatHistoryPath } from "../paths";
import { buildManifest } from "../../src/lift/buildManifest";
import { renderJson, renderMarkdown } from "../../src/lift/render";
import type { ChatMessage } from "../types";

async function readFirstUserPrompt(slug: string): Promise<string> {
  try {
    const raw = await fs.readFile(chatHistoryPath(slug), "utf-8");
    const messages = JSON.parse(raw) as ChatMessage[];
    const first = messages.find((m) => m.role === "user" && typeof m.content === "string");
    if (!first) return "";
    // Keep the summary short — 2-4 sentences' worth.
    const text = (first.content as string).trim();
    return text.length > 400 ? text.slice(0, 400) + "…" : text;
  } catch {
    return "";
  }
}

export async function emitLiftForFrame(slug: string, frame: string): Promise<void> {
  const fPath = path.join(frameDir(slug, frame), "index.tsx");
  let source: string;
  try {
    source = await fs.readFile(fPath, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") return;
    throw err;
  }

  const intent = await readFirstUserPrompt(slug);
  const manifest = buildManifest({
    projectSlug: slug,
    frameSlug: frame,
    frameAbsPath: fPath,
    frameSource: source,
    intentSummary: intent,
    figmaUrl: undefined,
    screenshotUrl: `/api/projects/${slug}/thumbnails/${frame}.png`,
  });

  const dir = path.dirname(fPath);
  await fs.writeFile(path.join(dir, "LIFT.md"), renderMarkdown(manifest));
  await fs.writeFile(path.join(dir, "LIFT.json"), renderJson(manifest));
}

function parseFrameTouched(filePath: string): { slug: string; frame: string } | null {
  const rel = path.relative(projectsRoot(), filePath);
  const parts = rel.split(path.sep);
  // Shape: <slug>/frames/<frame>/index.tsx
  if (parts.length < 4) return null;
  if (parts[1] !== "frames") return null;
  if (parts[3] !== "index.tsx") return null;
  return { slug: parts[0], frame: parts[2] };
}

export function liftEmitPlugin(): Plugin {
  let watcher: chokidar.FSWatcher | null = null;
  return {
    name: "arcade-studio-lift-emit",
    configureServer() {
      watcher = chokidar.watch(projectsRoot(), { ignoreInitial: true, depth: 6 });
      watcher.on("all", async (_event, filePath) => {
        const parsed = parseFrameTouched(filePath);
        if (!parsed) return;
        try {
          await emitLiftForFrame(parsed.slug, parsed.frame);
        } catch (err) {
          console.warn(`[liftEmitPlugin] failed for ${parsed.slug}/${parsed.frame}:`, err);
        }
      });
    },
    async closeBundle() { await watcher?.close(); },
  };
}
