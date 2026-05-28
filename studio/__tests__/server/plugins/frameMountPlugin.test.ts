import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { frameMountPlugin } from "../../../server/plugins/frameMountPlugin";

/**
 * Send a raw HTTP request with the literal path bytes preserved. `fetch` /
 * `new URL()` normalize percent-encoded dots and slashes before the request
 * is sent, which prevents us from exercising the server's traversal-rejection
 * code path. Node's `http.request` with `path` set bypasses that.
 */
function rawRequest(
  port: number,
  rawPath: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "localhost", port, path: rawPath, method: "GET" },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

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
    await server.close();
  });

  it("serves a spectator bootstrap HTML at /api/shared-projects/:id/frame/:framePath", async () => {
    // Seed the spectator mirror cache: same on-disk layout the
    // sharedProjects/relayClient writes when a `frame_written` event
    // arrives. The endpoint should compile + return HTML for it.
    const sharedDir = path.join(tmp, "shared-projects", "share-1", "frames");
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(
      path.join(sharedDir, "01-home.tsx"),
      `export default () => <div>Hello from spectator</div>;`,
    );

    const server = await createServer({
      configFile: false,
      plugins: [frameMountPlugin()],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    const port = server.config.server.port!;
    const res = await fetch(
      `http://localhost:${port}/api/shared-projects/share-1/frame/01-home`,
    );
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<div id="root"></div>');
    // The bootstrap URL points at the shared-frame virtual module, not
    // the host one — that's how the load() decides which TSX to import.
    expect(html).toContain("virtual:arcade-studio-shared-frame.tsx");
    expect(html).toContain("id=share-1");
    expect(html).toContain("path=01-home");
    // Spectator endpoint omits the host's per-project theme-overrides
    // link (mirror cache has no project.json + no overrides file).
    expect(html).not.toContain("theme-overrides.css");
    await server.close();
  });

  it("returns 404 for an unknown spectator frame", async () => {
    const server = await createServer({
      configFile: false,
      plugins: [frameMountPlugin()],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    const port = server.config.server.port!;
    const res = await fetch(
      `http://localhost:${port}/api/shared-projects/no-such-id/frame/missing`,
    );
    expect(res.status).toBe(404);
    await server.close();
  });

  it("rejects path-traversal in spectator id without touching disk", async () => {
    // Plant a sentinel TSX outside the shared-projects/ root that an
    // unsanitized `path.join(root, id)` would happily reach. The
    // middleware MUST 400 before resolveFrameFsPath() can read it.
    const sentinel = path.join(tmp, "projects", "p", "frames", "welcome", "index.tsx");
    expect(fs.existsSync(sentinel)).toBe(true);

    const server = await createServer({
      configFile: false,
      plugins: [frameMountPlugin()],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    const port = server.config.server.port!;

    // `..%2F..%2Fprojects%2Fp%2Fframes%2Fwelcome` decodes to a relative
    // path that would escape `shared-projects/` if joined raw. Use raw
    // http.request so the percent-encoded bytes survive client-side URL
    // normalization (fetch/new URL would collapse `..` segments before
    // sending).
    const traversal = "..%2F..%2Fprojects%2Fp%2Fframes%2Fwelcome";
    const res = await rawRequest(
      port,
      `/api/shared-projects/${traversal}/frame/index`,
    );
    expect(res.status).toBe(400);
    // Body must not leak the on-disk TSX content.
    expect(res.body).not.toContain("Hi");
    expect(res.body).not.toContain("export default");
    await server.close();
  });

  it("rejects spectator ids with disallowed characters", async () => {
    const server = await createServer({
      configFile: false,
      plugins: [frameMountPlugin()],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    const port = server.config.server.port!;

    // Use percent-encoded forms — and rawRequest — so that segments like
    // `..` survive HTTP-client URL normalization. After decodeURIComponent
    // these become `..`, `.`, `a/b`, etc., which the validator must reject.
    const bads = [
      { label: "..", encoded: "%2E%2E" },
      { label: ".", encoded: "%2E" },
      { label: "a/b", encoded: "a%2Fb" },
      { label: "a.b", encoded: "a.b" },
      { label: "null byte", encoded: "%00abc" },
    ];
    for (const { label, encoded } of bads) {
      const res = await rawRequest(
        port,
        `/api/shared-projects/${encoded}/frame/index`,
      );
      expect(res.status, `id=${label}`).toBe(400);
    }
    await server.close();
  });

  it("escapes HTML in title to defend against XSS via frame slug", async () => {
    // A frame path containing `<script>` would break out of `<title>` if
    // interpolated raw. The middleware sanitizes the path first, but the
    // shell renderer also escapes — assert no raw `<script>alert(` survives.
    const sharedDir = path.join(tmp, "shared-projects", "share-1", "frames");
    fs.mkdirSync(sharedDir, { recursive: true });
    // The cache helper sanitizes `<script>...` into a safe filename, so we
    // place a TSX matching that sanitized form so the request resolves.
    const safeName = "_script_alert_1___script_";
    fs.writeFileSync(
      path.join(sharedDir, `${safeName}.tsx`),
      `export default () => <div>x</div>;`,
    );

    const server = await createServer({
      configFile: false,
      plugins: [frameMountPlugin()],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    const port = server.config.server.port!;
    // Use the safe (sanitized) name as the URL segment — the regex would
    // otherwise reject the raw `<script>` form. The defense being tested
    // is that `escapeHtml` applies to the title regardless of source.
    const res = await fetch(
      `http://localhost:${port}/api/shared-projects/share-1/frame/${safeName}`,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    // No raw script tag in the title, just escaped text. We at least know
    // the title contains the slug and the slug starts with `_`, so any
    // unescaped `<` would be visible in the output.
    expect(html).not.toMatch(/<title>[^<]*<script/i);
    await server.close();
  });
});
