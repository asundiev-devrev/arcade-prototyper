import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { framesMiddleware } from "../../../server/middleware/frames";
import { projectsMiddleware } from "../../../server/middleware/projects";

let tmp: string;
let server: http.Server;
let port: number;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-frames-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  // Compose with projectsMiddleware so we can create a project first, then
  // POST to its /frames endpoint.
  server = http.createServer((req, res) => {
    const chain = [projectsMiddleware(), framesMiddleware()];
    let i = 0;
    const next = () => {
      const mw = chain[i++];
      if (!mw) {
        res.writeHead(404);
        res.end();
        return;
      }
      void (mw as any)(req, res, next);
    };
    next();
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function req(method: string, p: string, body?: unknown) {
  const res = await fetch(`http://localhost:${port}${p}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("POST /api/projects/:slug/frames", () => {
  it("creates a blank frame with the next two-digit prefix", async () => {
    const c = await req("POST", "/api/projects", { name: "Demo", theme: "arcade", mode: "light" });
    const slug = c.body.slug as string;

    const r = await req("POST", `/api/projects/${slug}/frames`);
    expect(r.status).toBe(201);
    expect(r.body.slug).toBe("01-untitled-1");
    expect(r.body.name).toBe("Untitled 1");

    const idx = path.join(tmp, "projects", slug, "frames", "01-untitled-1", "index.tsx");
    const contents = fs.readFileSync(idx, "utf-8");
    expect(contents).toContain("This frame is blank");
    expect(contents).toContain("export default function");
  });

  it("returns 404 when the project does not exist", async () => {
    const r = await req("POST", "/api/projects/does-not-exist/frames");
    expect(r.status).toBe(404);
  });

  it("increments the untitled counter when called repeatedly", async () => {
    const c = await req("POST", "/api/projects", { name: "Demo", theme: "arcade", mode: "light" });
    const slug = c.body.slug as string;

    const first = await req("POST", `/api/projects/${slug}/frames`);
    const second = await req("POST", `/api/projects/${slug}/frames`);

    expect(first.body.slug).toBe("01-untitled-1");
    expect(second.body.slug).toBe("02-untitled-2");
    expect(second.body.name).toBe("Untitled 2");
  });

  it("numbers new frames after existing non-untitled frames", async () => {
    const c = await req("POST", "/api/projects", { name: "Demo", theme: "arcade", mode: "light" });
    const slug = c.body.slug as string;

    // Simulate a pre-existing frame on disk (like one the agent wrote).
    const d = path.join(tmp, "projects", slug, "frames", "01-home");
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "index.tsx"), "export default () => null;");

    const r = await req("POST", `/api/projects/${slug}/frames`);
    expect(r.status).toBe(201);
    expect(r.body.slug).toBe("02-untitled-1");
  });
});
