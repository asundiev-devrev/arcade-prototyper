import type { Plugin } from "vite";
import path from "node:path";
import { projectsRoot } from "../paths";

/**
 * Arcade-gen's globals.css hard-codes `@source` paths relative to the
 * repo, but studio projects live in the OS app-support dir (outside the
 * repo). Tailwind won't see their utility classes unless we also scan
 * that path. This plugin rewrites globals.css on load to append an
 * absolute `@source` pointing at the real studio projects root.
 */
export function injectStudioSourcePlugin(): Plugin {
  const target = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "..",
    "src",
    "styles",
    "globals.css",
  );
  return {
    name: "arcade-studio-inject-source",
    enforce: "pre",
    transform(code, id) {
      const [cleanId] = id.split("?");
      if (cleanId !== target) return null;
      const absSource = path.join(projectsRoot(), "**/frames/**/*.{ts,tsx}");
      return { code: code + `\n@source "${absSource}";\n`, map: null };
    },
  };
}
