import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { frameMountPlugin, buildFrameBootstrapSource, renderFrameShellHtml } from "../../../server/plugins/frameMountPlugin";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-fm-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  const frameDir = path.join(tmp, "projects", "p", "frames", "welcome");
  fs.mkdirSync(frameDir, { recursive: true });
  fs.writeFileSync(path.join(frameDir, "index.tsx"), `export default () => <div>Hi</div>;`);
  fs.writeFileSync(path.join(tmp, "projects", "p", "theme-overrides.css"), `:root { --x: 1; }`);
});

afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("frameMountPlugin", () => {
  it("serves a bootstrap HTML at /api/frames:project/:frame", async () => {
    const server = await createServer({
      configFile: false,
      plugins: [frameMountPlugin()],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    const port = server.config.server.port!;
    const res = await fetch(`http://localhost:${port}/api/frames/p/welcome`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("<div id=\"root\"></div>");
    expect(html).toContain("theme-overrides.css");
    expect(html).toContain("virtual:arcade-studio-frame.tsx");
    await server.close();
  });

  it("imports theme-overrides.css AFTER the kit styles.css in the bootstrap (cascade order)", () => {
    // The kit's styles.css and the override both define theme tokens under
    // ':root, :root.light' (equal specificity), so the tie breaks on SOURCE
    // ORDER. The static <head> link loaded BEFORE the JS-injected kit CSS and
    // lost (live gate: purple --surface-* defeated by the kit's #fff). The
    // override must be imported LAST of the CSS in the bootstrap so it wins.
    const src = buildFrameBootstrapSource({
      absFrame: "/proj/frames/welcome/index.tsx",
      absOverrides: "/proj/theme-overrides.css",
      mode: "light",
      slug: "p",
      frame: "welcome",
    });
    const kitIdx = src.indexOf("@xorkavi/arcade-gen/styles.css");
    const overrideIdx = src.indexOf("theme-overrides.css");
    expect(kitIdx).toBeGreaterThan(-1);
    expect(overrideIdx).toBeGreaterThan(-1);
    // Override import must come AFTER the kit styles import so it wins the tie.
    expect(overrideIdx).toBeGreaterThan(kitIdx);
    // And after tailwind + patches too (it's the LAST css import).
    expect(overrideIdx).toBeGreaterThan(src.indexOf("arcade-gen-patches.css"));
  });

  it("returns 404 for an unknown frame", async () => {
    const server = await createServer({
      configFile: false,
      plugins: [frameMountPlugin()],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    const port = server.config.server.port!;
    const res = await fetch(`http://localhost:${port}/api/frames/p/missing`);
    expect(res.status).toBe(404);
    await server.close();
  });

  it("bootstrap emits a happy-path frame-ready with the location nonce", () => {
    const src = buildFrameBootstrapSource({ absFrame: "/x/index.tsx", absOverrides: "/x/o.css", mode: "light", slug: "proj", frame: "01" });
    expect(src).toContain("arcade-studio:frame-ready");
    expect(src).toMatch(/location\.search|URLSearchParams/); // reads its own nonce
    expect(src).toMatch(/__arcadeFrameReadyPosted|readyPosted/); // idempotency guard
  });

  it("errorShim frame-error carries the nonce", () => {
    // renderFrameShellHtml embeds the errorShim; assert it reads the nonce + includes it
    const html = renderFrameShellHtml({ title: "t", mode: "light", overridesUrl: "", bootstrapUrl: "/b", errorScopeJson: { slug: "proj", frame: "01" } });
    expect(html).toContain("arcade-studio:frame-error");
    expect(html).toMatch(/location\.search|URLSearchParams/);
  });
});
