// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { uploadsMiddleware } from "../../../server/middleware/uploads";
import { createProject } from "../../../server/projects";
import { projectDir } from "../../../server/paths";

let server: http.Server; let port: number; let tmp: string;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-uploads-mw-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  server = http.createServer((req, res) => {
    const mw = uploadsMiddleware();
    mw(req, res, () => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "next called" } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("/api/uploads/:slug", () => {
  it("accepts a PNG upload and returns { path, url } with the file on disk", async () => {
    const p = await createProject({ name: "Demo", theme: "arcade", mode: "light" });
    const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
    const res = await fetch(`http://localhost:${port}/api/uploads/${p.slug}`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { path: string; url: string };
    expect(json.path).toMatch(/\.png$/);
    expect(json.url.startsWith("/@fs")).toBe(true);
    expect(json.url).toBe(`/@fs${json.path}`);
    // file is on disk
    const stat = await fsp.stat(json.path);
    expect(stat.isFile()).toBe(true);
    // file lives under the project's _uploads dir
    const uploadsDir = path.join(projectDir(p.slug), "_uploads");
    expect(json.path.startsWith(uploadsDir + path.sep)).toBe(true);
    // file contents match
    const written = await fsp.readFile(json.path);
    expect(Buffer.compare(written, body)).toBe(0);
  });

  it("rejects unsupported content types with 400", async () => {
    const p = await createProject({ name: "Plain", theme: "arcade", mode: "light" });
    const res = await fetch(`http://localhost:${port}/api/uploads/${p.slug}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: { message: string } };
    expect(json.error.message).toBe("Unsupported image type");
  });

  it("returns 404 for a nonexistent project slug", async () => {
    const body = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const res = await fetch(`http://localhost:${port}/api/uploads/does-not-exist`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body,
    });
    expect(res.status).toBe(404);
    // _uploads dir MUST NOT have been created
    const uploadsDir = path.join(projectDir("does-not-exist"), "_uploads");
    expect(fs.existsSync(uploadsDir)).toBe(false);
  });

  it("passes through (calls next) when URL does not match or method is not POST", async () => {
    const p = await createProject({ name: "Pass", theme: "arcade", mode: "light" });
    const res = await fetch(`http://localhost:${port}/api/uploads/${p.slug}`, {
      method: "GET",
    });
    expect(res.status).toBe(404);
    const json = await res.json() as { error: { message: string } };
    expect(json.error.message).toBe("next called");
  });

  it("rejects uploads larger than 10MB with 413", async () => {
    const p = await createProject({ name: "Big", theme: "arcade", mode: "light" });
    const body = Buffer.alloc(11 * 1024 * 1024, 0);
    // prepend PNG magic bytes so content passes type gating
    body[0] = 0x89; body[1] = 0x50; body[2] = 0x4e; body[3] = 0x47;
    const res = await fetch(`http://localhost:${port}/api/uploads/${p.slug}`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body,
    });
    expect(res.status).toBe(413);
    const json = await res.json() as { error: { message: string } };
    expect(json.error.message).toMatch(/too large/i);
  });

  it("passes through (calls next) when slug fails the canonical slug pattern", async () => {
    // Slug "-a" starts with a dash — fails `[a-z0-9][a-z0-9-]*`.
    const res = await fetch(`http://localhost:${port}/api/uploads/-a`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    expect(res.status).toBe(404);
    const json = await res.json() as { error: { message: string } };
    expect(json.error.message).toBe("next called");
  });
});
