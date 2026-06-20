import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { buildFrameBundle } from "../cloudflare/bundler";

export interface PackInput {
  tsx: string;
  mode?: "light" | "dark";
  theme?: "arcade" | "devrev-app";
}

function wrapHtml(theme: string, mode: string, bundle: { css: string; js: string }): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}" class="${mode}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>${bundle.css}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${bundle.js}</script>
  </body>
</html>`;
}

export async function packFromSource(input: PackInput): Promise<string> {
  const mode = input.mode ?? "light";
  const theme = input.theme ?? "arcade";
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arcade-sidecar-"));
  const frameDir = path.join(tmpRoot, "frames", "01-frame");
  await fs.mkdir(frameDir, { recursive: true });
  await fs.writeFile(path.join(frameDir, "index.tsx"), input.tsx, "utf-8");
  try {
    const bundle = await buildFrameBundle({ projectSlug: "sidecar", frameSlug: "01-frame", framePath: frameDir, theme, mode });
    return wrapHtml(theme, mode, bundle);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

// Pack a multi-file frame seed (a directory containing index.tsx + siblings).
export async function packFromDir(seedDir: string, opts?: { mode?: "light" | "dark"; theme?: "arcade" | "devrev-app" }): Promise<string> {
  const mode = opts?.mode ?? "light";
  const theme = opts?.theme ?? "arcade";
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arcade-sidecar-"));
  const frameDir = path.join(tmpRoot, "frames", "01-frame");
  await fs.mkdir(frameDir, { recursive: true });
  await fs.cp(seedDir, frameDir, { recursive: true });
  try {
    const bundle = await buildFrameBundle({ projectSlug: "sidecar", frameSlug: "01-frame", framePath: frameDir, theme, mode });
    return wrapHtml(theme, mode, bundle);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}
