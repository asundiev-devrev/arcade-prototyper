import type { Plugin } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectsRoot, userKitDir } from "../paths";

/**
 * Studio projects live in `~/Library/Application Support/arcade-studio/projects/`
 * — outside the repo, path varies per user. Tailwind v4's relative `@source`
 * globs in `studio/src/styles/tailwind.css` cannot reach there. This plugin
 * appends absolute `@source` directives pointing at the real projects root AND
 * the user-kit root so generated frame code and user-saved components are both
 * scanned for utility classes.
 */
/**
 * Absolute path to `studio/src/styles/tailwind.css`, resolved from this
 * module's URL. Exported so the packaged-path regression test can exercise it.
 *
 * MUST use fileURLToPath, NOT `new URL(moduleUrl).pathname`. The latter keeps
 * percent-encoding, so in the packaged app (installed at
 * "/Applications/Arcade Studio.app", a path WITH A SPACE) the result is
 * ".../Arcade%20Studio.app/.../tailwind.css" while Vite hands `transform` the
 * DECODED id — the `cleanId !== target` guard then always matches, the frames
 * @source glob is never appended, and Tailwind stops scanning generated frames
 * (padding + token colors silently drop). fileURLToPath decodes the space so
 * both sides agree in dev AND in the .app. See sibling modules (projects.ts,
 * templates.ts, claudeCode.ts) and the same warning in
 * hooks/validateArcadeImports.mjs. Auto-memory tailwind-v4-source-scanning.
 */
export function resolveTailwindTarget(moduleUrl: string): string {
  return path.resolve(
    path.dirname(fileURLToPath(moduleUrl)),
    "..",
    "..",
    "src",
    "styles",
    "tailwind.css",
  );
}

export function injectStudioSourcePlugin(): Plugin {
  const target = resolveTailwindTarget(import.meta.url);
  return {
    name: "arcade-studio-inject-source",
    enforce: "pre",
    transform(code, id) {
      const [cleanId] = id.split("?");
      if (cleanId !== target) return null;
      const projectsSource = path.join(projectsRoot(), "**/frames/**/*.{ts,tsx}");
      const userKitSource = path.join(userKitDir(), "**/*.{ts,tsx}");
      return { code: code + `\n@source "${projectsSource}";\n@source "${userKitSource}";\n`, map: null };
    },
  };
}
