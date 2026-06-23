import type { Plugin } from "vite";
import path from "node:path";
import { projectsRoot, userKitDir } from "../paths";

/**
 * Studio projects live in `~/Library/Application Support/arcade-studio/projects/`
 * — outside the repo, path varies per user. Tailwind v4's relative `@source`
 * globs in `studio/src/styles/tailwind.css` cannot reach there. This plugin
 * appends absolute `@source` directives pointing at the real projects root AND
 * the user-kit root so generated frame code and user-saved components are both
 * scanned for utility classes.
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
      const projectsSource = path.join(projectsRoot(), "**/frames/**/*.{ts,tsx}");
      const userKitSource = path.join(userKitDir(), "**/*.{ts,tsx}");
      return { code: code + `\n@source "${projectsSource}";\n@source "${userKitSource}";\n`, map: null };
    },
  };
}
