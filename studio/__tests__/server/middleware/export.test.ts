// studio/__tests__/server/middleware/export.test.ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { exportMiddleware } from "../../../server/middleware/export";
import { createProject } from "../../../server/projects";

let server: http.Server; let port: number; let tmp: string;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-export-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  server = http.createServer((req, res) => {
    exportMiddleware()(req, res, () => {
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

const slj = { slj: 1, frame: { slug: "p", project: "p", width: 1440, mode: "light" }, root: { kind: "element", tag: "div", box: { x: 0, y: 0, width: 1, height: 1 }, layout: null, style: {}, children: [] } };

describe("/api/projects/:slug/export/:frame.slj.json", () => {
  it("stores a POSTed SLJ and serves it back on GET", async () => {
    const p = await createProject({ name: "P", theme: "arcade", mode: "light" });
    const post = await fetch(`http://localhost:${port}/api/projects/${p.slug}/export/01-frame.slj.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slj),
    });
    expect(post.status).toBe(200);

    const get = await fetch(`http://localhost:${port}/api/projects/${p.slug}/export/01-frame.slj.json`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(slj);
  });

  it("404s when no SLJ has been saved", async () => {
    const p = await createProject({ name: "Q", theme: "arcade", mode: "light" });
    const get = await fetch(`http://localhost:${port}/api/projects/${p.slug}/export/99-none.slj.json`);
    expect(get.status).toBe(404);
  });

  it("rejects a non-JSON body with 400", async () => {
    const p = await createProject({ name: "R", theme: "arcade", mode: "light" });
    const post = await fetch(`http://localhost:${port}/api/projects/${p.slug}/export/01-frame.slj.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(post.status).toBe(400);
  });

  it("passes through on unrelated URLs", async () => {
    const res = await fetch(`http://localhost:${port}/api/other`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("next called");
  });
});
