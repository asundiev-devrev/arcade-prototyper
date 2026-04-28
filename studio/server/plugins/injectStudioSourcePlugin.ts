import type { Plugin } from "vite";
import path from "node:path";
import { projectsRoot } from "../paths";

/**
 * Studio projects live in `~/Library/Application Support/arcade-studio/projects/`
 * — outside the repo, path varies per user. Tailwind v4's relative `@source`
 * globs in `studio/src/styles/tailwind.css` cannot reach there. This plugin
 * appends an absolute `@source` pointing at the real projects root so
 * generated frame code is scanned for utility classes.
 */
export function injectStudioSourcePlugin(): Plugin {
  const target = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "src",
    "styles",
    "tailwind.css",
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
