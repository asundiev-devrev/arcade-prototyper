/**
 * Render-verify keystone v3 — isolation before/after. Pure helpers + the temp-dir
 * bundling for isolation-rendering a single edited PAGE. See the spec.
 *
 * Why isolation: v1/v2 measured the LIVE iframe, which renders a multi-page
 * frame's DEFAULT page (renderPage(active)) — never the edited page. Rendering
 * the target page directly via a synthetic entry removes the router from the
 * loop. Spike-proven: className-swallow → identical fp, real change → different.
 */
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { packFromDir } from "./sidecar/packFromSource";

/** The isolation index.tsx: render ONLY the target page, no sidebar/router. */
export function SYNTHETIC_ENTRY(targetRelPath: string): string {
  const noExt = targetRelPath.replace(/\.(tsx|ts)$/, "");
  return (
    `import * as React from "react";\n` +
    `import Page from "./${noExt}";\n` +
    `export default () => <Page />;\n`
  );
}

/** Pick the edited page from the frame diff's changed rel paths (project-root
 *  relative, e.g. "frames/01/pages/Preferences.tsx"). Returns a FRAME-relative
 *  path ("pages/Preferences.tsx" | "index.tsx") or null. */
export function resolveTargetPage(changedRelPaths: string[]): string | null {
  const pageRe = /(?:^|\/)frames\/[^/]+\/(pages\/[^/]+\.tsx)$/;
  for (const p of changedRelPaths) {
    const m = p.match(pageRe);
    if (m) return m[1];
  }
  const idxRe = /(?:^|\/)frames\/[^/]+\/(index\.tsx)$/;
  for (const p of changedRelPaths) {
    if (idxRe.test(p)) return "index.tsx";
  }
  return null;
}

/**
 * Build isolation HTML for one page variant: copy the real frame dir, overwrite
 * the target page with `targetSource`, overwrite index.tsx with the synthetic
 * entry, bundle via packFromDir. Returns the HTML string. Throws on bundle
 * failure (caller fails open).
 */
export async function buildIsolationHtml(
  frameDir: string,
  targetRelPath: string,
  targetSource: string,
): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rv-iso-"));
  try {
    await fs.cp(frameDir, tmp, { recursive: true });
    const target = path.join(tmp, targetRelPath);
    if (!path.resolve(target).startsWith(path.resolve(tmp))) throw new Error("path escape");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, targetSource, "utf-8");
    await fs.writeFile(path.join(tmp, "index.tsx"), SYNTHETIC_ENTRY(targetRelPath), "utf-8");
    return await packFromDir(tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// The corrective prompt lives in the BROWSER-SAFE client module
// (src/lib/renderVerifyClient.ts) — re-exported here for any server use. It
// must NOT be defined in this file: this module transitively imports packFromDir
// → esbuild + @tailwindcss/oxide (a native .node addon), so a CLIENT importing
// anything from here white-screens the app (Vite dev serves the shell untree-
// shaken → the browser eagerly loads the node-only graph). The client imports
// the const from renderVerifyClient.ts directly. See render-measurement blocker
// memory + the 0.42.0 devdep-runtime-crash lesson.
export { RENDER_VERIFY_CORRECTIVE_PROMPT } from "../src/lib/renderVerifyClient";

// NOTE: no one-shot Set here. The corrective reuses the EXISTING route
// (chat.ts handleRenderVerifyRetry), whose one-shot lives in server/renderVerify.ts.
// Redefining renderVerifyAlreadyRan/markRenderVerifyRan here would duplicate that binding.
