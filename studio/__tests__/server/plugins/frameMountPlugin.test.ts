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

  it("frame-height producer uses a jitter threshold, not exact-equal dedup", () => {
    // Regression: the height post guard was `h === last`, which only skipped
    // EXACT repeats — a 1px oscillation (899<->900) posted on every tick
    // forever. It must gate on a small absolute delta so sub-2px jitter stops.
    const src = buildFrameBootstrapSource({ absFrame: "/x/index.tsx", absOverrides: "/x/o.css", mode: "light", slug: "p", frame: "01" });
    expect(src).toContain("arcade-studio:frame-height");
    // Strip comments so we assert against CODE, not the explanatory prose.
    const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).toMatch(/Math\.abs\(h - last\)\s*<\s*2/);
    expect(code).not.toMatch(/h === last/);
  });

  it("errorShim frame-error carries the nonce", () => {
    // renderFrameShellHtml embeds the errorShim; assert it reads the nonce + includes it
    const html = renderFrameShellHtml({ title: "t", mode: "light", overridesUrl: "", bootstrapUrl: "/b", errorScopeJson: { slug: "proj", frame: "01" } });
    expect(html).toContain("arcade-studio:frame-error");
    expect(html).toMatch(/location\.search|URLSearchParams/);
    // Assert the nonce variable is REFERENCED in the postMessage payload (n: NONCE).
    // If this line is removed but the 'var NONCE' declaration stays, the test will fail.
    expect(html).toMatch(/n:\s*NONCE/);
  });
});

describe("errorShim keeps the DOM (never white-screen)", () => {
  const html = renderFrameShellHtml({ title: "t", mode: "light", overridesUrl: "", bootstrapUrl: "/b", errorScopeJson: { slug: "proj", frame: "01" } });

  it("still posts frame-error with the nonce (unchanged)", () => {
    expect(html).toContain("arcade-studio:frame-error");
    expect(html).toMatch(/n:\s*NONCE/);
  });

  it("branches on whether the frame rendered (does NOT unconditionally wipe)", () => {
    // the mounted branch must be guarded by a rendered-state check, not a bare innerHTML=""
    expect(html).toMatch(/childElementCount|querySelector|children\.length/);
  });

  it("appends a max-z-index status overlay (does not rely on frame z-index)", () => {
    expect(html).toContain("data-arcade-status-overlay");
    expect(html).toMatch(/2147483647/);
  });

  it("is idempotent — checks for an existing overlay before appending", () => {
    // e.g. if (document.querySelector("[data-arcade-status-overlay]")) return;
    expect(html).toMatch(/querySelector\(\s*["'`]\[data-arcade-status-overlay\]/);
  });

  it("still keeps a panel for the empty (module-load) case", () => {
    // the empty branch retains innerHTML="" + the calm panel text
    expect(html).toContain("Auto-repairing this frame");
  });

  it("softens the resting-state copy after a bounded wait (constraint 5)", () => {
    // a pure interaction error may never get a repair swap — the banner must
    // stop promising 'Refining…' forever and tell the user what to do.
    expect(html).toMatch(/setTimeout/);
    expect(html).toContain("Couldn't apply that change automatically");
  });

  it("softener targets the sub-line by marker, NOT a bare-div query (would corrupt the dot+title head)", () => {
    // regression guard: the sub element carries data-arcade-status-sub and the
    // softener queries THAT, never a bare 'div' (the head flex-row is the first
    // div; textContent on it destroys the dot+title).
    expect(html).toContain("data-arcade-status-sub");
    expect(html).toMatch(/querySelector\(\s*["'`]\[data-arcade-status-sub\]/);
    // Strip JS comments FIRST — the errorShim's own explanatory comments ship
    // verbatim into the HTML, so assert against CODE, not comment text. Then no
    // bare-div lookup may survive (that's the corruption path).
    const codeOnly = html.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codeOnly).not.toMatch(/querySelector\(\s*["'`]div["'`]\s*\)/);
  });

  it("the emitted errorShim script PARSES (guards against an escaping regression)", () => {
    // Substring asserts can't catch a syntax error inside the template-embedded
    // IIFE — a bad escape would still contain the substrings and ship a shim
    // that white-screens on EVERY error. Extract the <script> and parse it.
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    // eslint-disable-next-line no-new-func
    expect(() => new Function(m![1])).not.toThrow();
  });
});
