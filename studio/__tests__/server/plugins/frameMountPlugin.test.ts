import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { frameMountPlugin } from "../../../server/plugins/frameMountPlugin";

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
});
