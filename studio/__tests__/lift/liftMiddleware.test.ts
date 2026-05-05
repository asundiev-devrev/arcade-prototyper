import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { liftMiddleware } from "../../server/middleware/lift";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-liftmw-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  const frameDir = path.join(tmp, "projects", "p", "frames", "hello");
  fs.mkdirSync(frameDir, { recursive: true });
  fs.writeFileSync(path.join(frameDir, "LIFT.md"), "# Lift Manifest — p/hello\n");
  fs.writeFileSync(path.join(frameDir, "LIFT.json"), '{"schemaVersion":1}\n');
});

afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("liftMiddleware", () => {
  it("serves LIFT.md at /api/projects/:slug/lift/:frame.md", async () => {
    const server = await createServer({
      configFile: false,
      plugins: [
        {
          name: "t",
          configureServer(s) { s.middlewares.use(liftMiddleware()); },
        },
      ],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    const port = server.config.server.port!;
    const res = await fetch(`http://localhost:${port}/api/projects/p/lift/hello.md`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(text).toContain("# Lift Manifest — p/hello");
    await server.close();
  });

  it("serves LIFT.json at /api/projects/:slug/lift/:frame.json", async () => {
    const server = await createServer({
      configFile: false,
      plugins: [
        {
          name: "t",
          configureServer(s) { s.middlewares.use(liftMiddleware()); },
        },
      ],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    const port = server.config.server.port!;
    const res = await fetch(`http://localhost:${port}/api/projects/p/lift/hello.json`);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(json.schemaVersion).toBe(1);
    await server.close();
  });

  it("returns 404 when the manifest is missing", async () => {
    const server = await createServer({
      configFile: false,
      plugins: [
        {
          name: "t",
          configureServer(s) { s.middlewares.use(liftMiddleware()); },
        },
      ],
      root: path.resolve(__dirname, "../../.."),
    });
    await server.listen(0);
    const port = server.config.server.port!;
    const res = await fetch(`http://localhost:${port}/api/projects/p/lift/missing.md`);
    expect(res.status).toBe(404);
    await server.close();
  });
});
