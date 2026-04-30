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
      } finally {
        delete process.env.ARCADE_STUDIO_ROOT;
        fs.rmSync(studioRootTmp, { recursive: true, force: true });
      }
    },
  );
});
