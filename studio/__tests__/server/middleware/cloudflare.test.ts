import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("esbuild", () => ({
  build: vi.fn(async () => ({
    outputFiles: [
      { path: "/test.js", text: "console.log('test');" },
      { path: "/test.css", text: "body { margin: 0; }" },
    ],
  })),
}));

describe("cloudflareMiddleware", () => {
  let studioTmp: string;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    studioTmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-cloudflare-mw-"));
    process.env.ARCADE_STUDIO_ROOT = studioTmp;
  });

  afterEach(() => {
    delete process.env.ARCADE_STUDIO_ROOT;
    fs.rmSync(studioTmp, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it("passes through non-matching routes", async () => {
    const { cloudflareMiddleware } = await import("../../../server/middleware/cloudflare");
    const middleware = cloudflareMiddleware();
    const req = { url: "/api/projects", method: "GET" } as IncomingMessage;
    const res = {} as ServerResponse;
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("returns 400 when frameSlug is missing from the body", async () => {
    const { cloudflareMiddleware } = await import("../../../server/middleware/cloudflare");
    const middleware = cloudflareMiddleware();
    const req = {
      url: "/api/projects/test-project/share",
      method: "POST",
      [Symbol.asyncIterator]: async function* () {
        yield JSON.stringify({});
      },
    } as any;
    const res = { writeHead: vi.fn(), end: vi.fn() } as any;

    await middleware(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(400, { "Content-Type": "application/json" });
    expect(res.end).toHaveBeenCalledWith(
      expect.stringContaining("missing_frame"),
    );
  });

  it("returns 400 with 'no_share_key' when the share key is absent", async () => {
    // Intentionally no settings.json — middleware should fail fast before
    // any network call so the user sees a clear "configure your share key"
    // message instead of a confusing network error.
    const { cloudflareMiddleware } = await import("../../../server/middleware/cloudflare");
    const middleware = cloudflareMiddleware();
    const req = {
      url: "/api/projects/test-project/share",
      method: "POST",
      [Symbol.asyncIterator]: async function* () {
        yield JSON.stringify({ frameSlug: "hero" });
      },
    } as any;
    const res = { writeHead: vi.fn(), end: vi.fn() } as any;

    await middleware(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(400, { "Content-Type": "application/json" });
    const body = res.end.mock.calls[0][0] as string;
    expect(body).toContain("no_share_key");
  });

  it("deploys each frame as its own production (main) Pages project", async () => {
    // Regression for the share-URL bug: deploying to a per-frame *branch*
    // produced a two-label host (<frame>.<project>.pages.dev) the universal
    // *.pages.dev cert can't cover (TLS handshake fails forever), while the
    // apex stayed empty ("Nothing is here yet") because nothing ever hit the
    // production branch. The fix: one project PER FRAME, branch "main", so
    // the URL is the apex single-label host that certs instantly.
    //
    // We stub the Worker client so no real network call happens, and assert
    // the contract the Worker depends on: project name = slug-frameSlug,
    // branch = "main".
    const deploySpy = vi.fn(async () => ({
      url: "https://my-proj-hero.pages.dev",
      deployId: "d1",
    }));
    vi.doMock("../../../server/cloudflare/deploy", async () => {
      const actual = await vi.importActual<any>("../../../server/cloudflare/deploy");
      return { ...actual, deployViaWorker: deploySpy };
    });
    vi.doMock("../../../server/cloudflare/bundler", () => ({
      buildFrameBundle: vi.fn(async () => ({
        html: "<html></html>",
        js: "",
        css: "",
      })),
    }));

    // settings.json with a share key so the middleware proceeds to deploy.
    fs.writeFileSync(
      path.join(studioTmp, "settings.json"),
      JSON.stringify({ cloudflare: { shareKey: "deadbeef" } }),
    );
    // project.json with the frame we're sharing.
    const projDir = path.join(studioTmp, "projects", "my-proj");
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(
      path.join(projDir, "project.json"),
      JSON.stringify({
        slug: "my-proj",
        theme: "arcade",
        mode: "light",
        frames: [{ slug: "hero", name: "Hero", size: 1440 }],
      }),
    );

    const { cloudflareMiddleware } = await import("../../../server/middleware/cloudflare");
    const middleware = cloudflareMiddleware();
    const req = {
      url: "/api/projects/my-proj/share",
      method: "POST",
      [Symbol.asyncIterator]: async function* () {
        yield JSON.stringify({ frameSlug: "hero" });
      },
    } as any;
    const res = { writeHead: vi.fn(), end: vi.fn() } as any;

    await middleware(req, res);

    expect(deploySpy).toHaveBeenCalledTimes(1);
    const arg = deploySpy.mock.calls[0][0] as any;
    expect(arg.pagesProjectName).toBe("my-proj-hero");
    expect(arg.branch).toBe("main");
    expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
  });
});
