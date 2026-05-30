import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { buildFrameBundle } from "../cloudflare/bundler";

export interface PackInput {
  tsx: string;
  mode?: "light" | "dark";
  theme?: "arcade" | "devrev-app";
}

// Pack a single arcade frame (.tsx source) into one self-contained HTML
// string: css inlined in <style>, js inlined in a module <script>, no
// external asset references. This is what Computer's canvas iframe renders.
export async function packFromSource(input: PackInput): Promise<string> {
  const mode = input.mode ?? "light";
  const theme = input.theme ?? "arcade";
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "arcade-sidecar-"));
  const frameDir = path.join(tmpRoot, "frames", "01-frame");
  await fs.mkdir(frameDir, { recursive: true });
  await fs.writeFile(path.join(frameDir, "index.tsx"), input.tsx, "utf-8");
  try {
    const bundle = await buildFrameBundle({
      projectSlug: "sidecar",
      frameSlug: "01-frame",
      framePath: frameDir,
      theme,
      mode,
    });
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
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}
