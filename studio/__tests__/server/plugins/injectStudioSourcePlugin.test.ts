import { describe, it, expect } from "vitest";
import { pathToFileURL } from "node:url";
import { resolveTailwindTarget } from "../../../server/plugins/injectStudioSourcePlugin";

describe("resolveTailwindTarget", () => {
  it("resolves to studio/src/styles/tailwind.css from a plugin-dir module url", () => {
    const moduleUrl = pathToFileURL(
      "/Users/dev/arcade/studio/server/plugins/injectStudioSourcePlugin.ts",
    ).href;
    expect(resolveTailwindTarget(moduleUrl)).toBe(
      "/Users/dev/arcade/studio/src/styles/tailwind.css",
    );
  });

  it("DECODES %20 in a packaged-app path (regression: cramped frames in .app)", () => {
    // The packaged app installs at "/Applications/Arcade Studio.app" — a path
    // WITH A SPACE. import.meta.url percent-encodes it. If the target keeps the
    // encoding it never equals Vite's decoded transform id, the frames @source
    // glob is never appended, and generated frames lose their Tailwind
    // utilities (padding + token colors) — only in the .app, not on localhost.
    const packagedUrl =
      "file:///Applications/Arcade%20Studio.app/Contents/Resources/app/studio/server/plugins/injectStudioSourcePlugin.ts";
    const target = resolveTailwindTarget(packagedUrl);
    expect(target).toBe(
      "/Applications/Arcade Studio.app/Contents/Resources/app/studio/src/styles/tailwind.css",
    );
    // Guard the exact defect: no lingering percent-encoding.
    expect(target).not.toContain("%20");
  });
});
