// @vitest-environment node
import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import path from "node:path";

/**
 * Guard against the render-verify white-screen class (a294170): the client hook
 * `useProjectFromHost` must NEVER transitively import a node-only module. It
 * once imported `RENDER_VERIFY_CORRECTIVE_PROMPT` from server/renderVerifyIsolation,
 * which pulls packFromDir → esbuild + @tailwindcss/oxide (a native .node addon).
 * Studio serves the shell via Vite DEV (no tree-shaking), so the browser eagerly
 * loads that node graph → React never mounts → white screen. tsc + jsdom unit
 * tests were all green while the packaged app was dead — the 0.42.0
 * devdep-runtime-crash profile. This test browser-bundles the hook and asserts
 * the node graph is absent, catching the regression a pure unit test can't.
 */
describe("render-verify client stays browser-safe", () => {
  it("useProjectFromHost browser-bundles with NO node-only resolution", async () => {
    const entry = path.resolve(__dirname, "../../src/hooks/useProjectFromHost.ts");
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      platform: "browser",
      format: "esm",
      logLevel: "silent",
      jsx: "automatic",
      // React/DOM are provided by the app runtime; we only care whether a
      // NODE-only module (fs/path/os/esbuild/.node) sneaks into the graph.
      external: ["react", "react-dom", "react/*", "react-dom/*"],
    }).catch((e: unknown) => ({ errors: [{ text: String(e) }] } as { errors: { text: string }[] }));

    const errs = (result as { errors: { text: string }[] }).errors ?? [];
    const nodeGraphErrors = errs.filter((e) =>
      /node:|"fs"|"os"|"path"|"child_process"|\.node|esbuild|@tailwindcss\/oxide/i.test(e.text),
    );
    expect(
      nodeGraphErrors.map((e) => e.text).join("\n"),
    ).toBe("");
  });
});
