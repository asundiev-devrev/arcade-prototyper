import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const { buildMock } = vi.hoisted(() => ({ buildMock: vi.fn() }));
vi.mock("esbuild", () => ({
  build: buildMock,
}));

describe("buildFrameBundle", () => {
  beforeEach(() => {
    buildMock.mockReset();
    buildMock.mockResolvedValue({
      outputFiles: [
        { path: "/test.js", text: "console.log('test');" },
        { path: "/test.css", text: "body { margin: 0; }" },
      ],
    });
  });

  it(
    "passes absWorkingDir + nodePaths to esbuild so it finds the repo's node_modules",
    async () => {
      // Regression guard: the entrypoint is written under
      // ~/Library/Application Support/arcade-studio/.temp/, which is outside
      // the repo. Without absWorkingDir (pointing at the repo) and nodePaths
      // (listing the repo's node_modules), esbuild's default "walk up from
      // the entrypoint" resolution walks straight past $HOME without finding
      // react/react-dom/@xorkavi/arcade-gen and fails with:
      //   "Could not resolve 'react'"
      // This was a production bug reported by a beta tester deploying a
      // frame to Vercel.
      const studioRootTmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-bundler-"));
      const frameDir = path.join(studioRootTmp, "frame");
      fs.mkdirSync(frameDir, { recursive: true });
      fs.writeFileSync(path.join(frameDir, "index.tsx"), "export default () => null;\n");
      process.env.ARCADE_STUDIO_ROOT = studioRootTmp;

      try {
        const { buildFrameBundle } = await import("../../../server/vercel/bundler");
        await buildFrameBundle({
          projectSlug: "p",
          frameSlug: "f",
          framePath: frameDir,
          theme: "arcade",
          mode: "light",
        });

        expect(buildMock).toHaveBeenCalledTimes(1);
        const opts = buildMock.mock.calls[0][0] as any;

        // absWorkingDir must be an absolute path that contains a
        // node_modules directory holding react.
        expect(opts.absWorkingDir).toBeDefined();
        expect(path.isAbsolute(opts.absWorkingDir)).toBe(true);

        // nodePaths must include a path ending in node_modules.
        expect(Array.isArray(opts.nodePaths)).toBe(true);
        expect(
          opts.nodePaths.some((p: string) => p.endsWith(path.join("node_modules"))),
        ).toBe(true);

        // alias map must cover the specifiers generated frames commonly use.
        // Keep in sync with studio/vite.config.ts. Regression guard: a
        // generated frame that does `import { Button } from "arcade"` or
        // `import { AppShell } from "arcade/components"` must bundle, not
        // fail with "Could not resolve 'arcade/components'".
        expect(opts.alias).toBeDefined();
        expect(opts.alias["arcade"]).toBe("@xorkavi/arcade-gen");
        expect(opts.alias["arcade/components"]).toBe("@xorkavi/arcade-gen");
        expect(opts.alias["arcade-prototypes"]).toMatch(/prototype-kit$/);
      } finally {
        delete process.env.ARCADE_STUDIO_ROOT;
        fs.rmSync(studioRootTmp, { recursive: true, force: true });
      }
    },
  );

  it(
    "entrypoint imports arcade-gen-patches.css from the studio source tree, NOT the user-data dir",
    async () => {
      // Regression guard: earlier the bundler used `studioRoot()` (which
      // returns the user-data dir) to compute the patches CSS path. That
      // dir does NOT contain src/styles/; only <repo>/studio/src/styles
      // does. esbuild failed with:
      //   Could not resolve "/Users/.../arcade-studio/src/styles/..."
      // We now derive the CSS path from REPO_ROOT (the repo root, resolved
      // from bundler.ts's own file location).
      const studioRootTmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-bundler-2-"));
      const frameDir = path.join(studioRootTmp, "frame");
      fs.mkdirSync(frameDir, { recursive: true });
      fs.writeFileSync(path.join(frameDir, "index.tsx"), "export default () => null;\n");
      process.env.ARCADE_STUDIO_ROOT = studioRootTmp;

      // Capture the entrypoint file esbuild is asked to bundle so we can
      // inspect the CSS import inside it.
      buildMock.mockImplementation(async (opts: any) => {
        const entryPath = Array.isArray(opts.entryPoints) ? opts.entryPoints[0] : opts.entryPoints;
        const entryText = fs.readFileSync(entryPath, "utf-8");
        // Expect the patches CSS reference to be under studio/src/styles,
        // and NOT under the user-data directory.
        expect(entryText).toMatch(/studio\/src\/styles\/arcade-gen-patches\.css/);
        expect(entryText).not.toMatch(/Application Support\/arcade-studio\/src\/styles/);
        return {
          outputFiles: [
            { path: "/test.js", text: "" },
            { path: "/test.css", text: "" },
          ],
        };
      });

      try {
        const { buildFrameBundle } = await import("../../../server/vercel/bundler");
        await buildFrameBundle({
          projectSlug: "p",
          frameSlug: "f",
          framePath: frameDir,
          theme: "arcade",
          mode: "light",
        });
      } finally {
        delete process.env.ARCADE_STUDIO_ROOT;
        fs.rmSync(studioRootTmp, { recursive: true, force: true });
      }
    },
  );
});
