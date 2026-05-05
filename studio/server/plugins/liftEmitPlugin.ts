// studio/server/plugins/liftEmitPlugin.ts
//
// Watches each project's frames directory. Whenever a frame's index.tsx
// changes, regenerate LIFT.xml and LIFT.json next to it.
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
import { renderJson, renderXml } from "../../src/lift/render";
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
  await fs.writeFile(path.join(dir, "LIFT.xml"), renderXml(manifest));
  await fs.writeFile(path.join(dir, "LIFT.json"), renderJson(manifest));

  // Remove any lingering LIFT.md from an older Studio install. As of 0.9.0
  // the markdown form was dropped in favor of XML; leaving stale .md files
  // on disk would mislead anyone who grepped the project directory.
  try {
    await fs.unlink(path.join(dir, "LIFT.md"));
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.warn(`[liftEmitPlugin] failed to clean stale LIFT.md for ${slug}/${frame}:`, err);
    }
  }
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

/**
 * Walk existing frames on boot and emit a manifest for each.
 *
 * Without this pass, frames that already exist when Studio starts never get
 * a LIFT.xml until their index.tsx is touched — so the UI's "Copy Lift
 * Manifest" button 404s for anything not edited this session. The watcher
 * below still handles post-boot changes; this just closes the cold-start gap.
 * As a side effect this also removes any stale LIFT.md files left behind by
 * an older Studio install (see emitLiftForFrame).
 */
async function emitForExistingFrames(): Promise<void> {
  let slugs: string[];
  try {
    slugs = await fs.readdir(projectsRoot());
  } catch (err: any) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const slug of slugs) {
    if (slug.startsWith(".")) continue;
    const framesDir = path.join(projectsRoot(), slug, "frames");
    let frames: string[];
    try { frames = await fs.readdir(framesDir); } catch { continue; }
    for (const frame of frames) {
      if (frame.startsWith(".")) continue;
      try {
        await emitLiftForFrame(slug, frame);
      } catch (err) {
        console.warn(`[liftEmitPlugin] initial emit failed for ${slug}/${frame}:`, err);
      }
    }
  }
}

export function liftEmitPlugin(): Plugin {
  let watcher: chokidar.FSWatcher | null = null;
  return {
    name: "arcade-studio-lift-emit",
    configureServer() {
      // Cold-start pass: emit a manifest for every already-existing frame
      // before we start listening for changes. Fire-and-forget so server
      // boot isn't blocked on the walk.
      void emitForExistingFrames();

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

// Exported for tests: exercise the cold-start pass without spinning up Vite.
export { emitForExistingFrames };
