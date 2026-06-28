// @vitest-environment node
// esbuild's runtime requires a real Node TextEncoder (jsdom's breaks its
// startup invariant), so this suite must run in the node environment, not the
// default jsdom one.
import { describe, it, expect } from "vitest";
import path from "node:path";
import { build } from "esbuild";

/**
 * REGRESSION GUARD — gridstack-at-config-load crash.
 *
 * vite.config.ts statically imports chat.ts, which (fire-and-forget) pulls the
 * `server/expand` tree. esbuild's config bundler INLINES that dynamic import,
 * so anything `server/expand/*` statically imports ends up in vite.config's
 * graph. If the auto-expand code ever imports a React kit composite/template
 * (SettingsPage.tsx, AppShell.tsx, …), it transitively pulls the
 * `@xorkavi/arcade-gen` barrel → gridstack, whose extensionless ESM subpath
 * import (`./gridstack-engine`) only a bundler can resolve. Under Node ESM —
 * how Vite loads its config — that crashes `pnpm run studio` at startup with
 * ERR_MODULE_NOT_FOUND for `gridstack/dist/gridstack-engine`.
 *
 * The authored expansion (expandSettingsPage) is a PURE STRING BUILDER and
 * lives in an import-free module (SettingsPage.expand.ts) precisely so the
 * server-side registry can consume it without dragging the barrel in. This test
 * bundles the expand entry exactly as the config loader would (Node platform,
 * node_modules left external) and asserts the resolved import graph contains
 * NEITHER the arcade-gen barrel NOR gridstack. If someone re-introduces a
 * composite import into the expand tree, this fails here instead of white-
 * screening every tester's `pnpm run studio`.
 */
describe("server/expand stays free of the kit barrel (gridstack config-load guard)", () => {
  it("postGenHook's import graph never reaches @xorkavi/arcade-gen or gridstack", async () => {
    const entry = path.resolve(__dirname, "../../../server/expand/postGenHook.ts");
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      packages: "external", // mirror vite's config load: node_modules stay external
      metafile: true,
      logLevel: "silent",
    });
    const inputs = Object.keys(result.metafile.inputs);
    const offenders: string[] = [];
    for (const [file, info] of Object.entries(result.metafile.inputs)) {
      for (const imp of info.imports ?? []) {
        if (/@xorkavi\/arcade-gen|(^|\/)gridstack($|\/)/.test(imp.path)) {
          offenders.push(`${file} -> ${imp.path}`);
        }
      }
    }
    expect(
      offenders,
      `expand tree must not import the kit barrel/gridstack (crashes vite.config load). Offenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
    // sanity: the bundle actually traced the expand tree (not an empty graph)
    expect(inputs.some((f) => /server\/expand\/registry\.ts$/.test(f))).toBe(true);
    expect(inputs.some((f) => /SettingsPage\.expand\.ts$/.test(f))).toBe(true);
  });
});
