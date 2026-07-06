// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { projectsMiddleware } from "../../../server/middleware/projects";
import { createProject } from "../../../server/projects";

let tmp: string, home: string, server: Server, port: number;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-mw-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-mwhome-"));
  process.env.HOME = home;
  const mw = projectsMiddleware();
  server = createServer((req, res) => mw(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as any).port;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe("export/import routes", () => {
  it("round-trips a project through HTTP", async () => {
    const proj = await createProject({ name: "HTTP Trip", theme: "arcade", mode: "light" });
    const exp = await fetch(`http://localhost:${port}/api/projects/${proj.slug}/export`);
    expect(exp.status).toBe(200);
    expect(exp.headers.get("content-disposition")).toContain(`${proj.slug}.arcade`);
    const buf = Buffer.from(await exp.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);

    const imp = await fetch(`http://localhost:${port}/api/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: buf,
    });
    expect(imp.status).toBe(201);
    const body = await imp.json();
    expect(body.slug).toBeTruthy();
    expect(body.name).toMatch(/imported/i); // collided with the original in the same root
  });

  it("404s export for an unknown project", async () => {
    const res = await fetch(`http://localhost:${port}/api/projects/nope/export`);
    expect(res.status).toBe(404);
  });

  it("422s a malformed import body", async () => {
    const res = await fetch(`http://localhost:${port}/api/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: Buffer.from("not a tar"),
    });
    expect(res.status).toBe(422);
  });
});
