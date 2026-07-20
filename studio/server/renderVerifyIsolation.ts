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

export const RENDER_VERIFY_CORRECTIVE_PROMPT =
  "Your last change did not alter the rendered result at all — the page renders " +
  "identically to before your edit. The property you set is being ignored by the " +
  "component. Achieve the intent a different way — a wrapper with real layout/utility " +
  "classes, or a different component — so it ACTUALLY renders. If the kit genuinely " +
  "can't do it, tell the user plainly what you couldn't do and why. Never report a " +
  "visual result the render doesn't show. Keep the response shape: a one-sentence " +
  "summary plus a ### Deviations section.";

// NOTE: no one-shot Set here. The corrective reuses the EXISTING route
// (chat.ts handleRenderVerifyRetry), whose one-shot lives in server/renderVerify.ts.
// Redefining renderVerifyAlreadyRan/markRenderVerifyRan here would duplicate that binding.
