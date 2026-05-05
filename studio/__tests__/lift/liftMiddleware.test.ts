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
  fs.writeFileSync(
    path.join(frameDir, "LIFT.xml"),
    `<lift_manifest schema_version="1" project="p" frame="hello" shape="ad-hoc"></lift_manifest>\n`,
  );
  fs.writeFileSync(path.join(frameDir, "LIFT.json"), '{"schemaVersion":1}\n');
});

afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function makeServer() {
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
  return server;
}

describe("liftMiddleware", () => {
  it("serves LIFT.xml at /api/projects/:slug/lift/:frame.xml", async () => {
    const server = await makeServer();
    const port = server.config.server.port!;
    const res = await fetch(`http://localhost:${port}/api/projects/p/lift/hello.xml`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(text).toContain(`<lift_manifest schema_version="1"`);
    expect(text).toContain(`project="p"`);
    await server.close();
  });

  it("serves LIFT.json at /api/projects/:slug/lift/:frame.json", async () => {
    const server = await makeServer();
    const port = server.config.server.port!;
    const res = await fetch(`http://localhost:${port}/api/projects/p/lift/hello.json`);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(json.schemaVersion).toBe(1);
    await server.close();
  });

  it("returns 404 when the manifest is missing", async () => {
    const server = await makeServer();
    const port = server.config.server.port!;
    const res = await fetch(`http://localhost:${port}/api/projects/p/lift/missing.xml`);
    expect(res.status).toBe(404);
    await server.close();
  });

  // Regression: previously the middleware handled .md; make sure a stale
  // 0.8.x client that still asks for .md gets a clean pass-through (404 from
  // the middleware, not accidentally matched) rather than silently serving
  // the wrong thing.
  it("does not match the old .md extension", async () => {
    const server = await makeServer();
    const port = server.config.server.port!;
    const res = await fetch(`http://localhost:${port}/api/projects/p/lift/hello.md`);
    expect(res.status).toBe(404);
    await server.close();
  });
});
