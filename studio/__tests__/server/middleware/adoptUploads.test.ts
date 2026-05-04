// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { adoptUploadsMiddleware } from "../../../server/middleware/adoptUploads";
import { createProject } from "../../../server/projects";
import { stagingSessionDir } from "../../../server/paths";

let server: http.Server;
let port: number;
let tmp: string;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-adopt-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  server = http.createServer(adoptUploadsMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ARCADE_STUDIO_ROOT;
});

async function post(pathname: string, body: any, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(buf.length), ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
        });
      },
    );
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

describe("POST /api/projects/:slug/adopt-uploads", () => {
  it("moves files from staging into the project and reports mapping", async () => {
    const project = await createProject({ name: "Test", theme: "arcade", mode: "light" });
    const sessionDir = stagingSessionDir("alice");
    fs.mkdirSync(sessionDir, { recursive: true });
    const stagedPath = path.join(sessionDir, "photo.png");
    fs.writeFileSync(stagedPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const res = await post(`/api/projects/${project.slug}/adopt-uploads`, {
      paths: [stagedPath],
    });

    expect(res.status).toBe(200);
    expect(res.body.missing).toEqual([]);
    expect(res.body.mapping[stagedPath]).toMatch(new RegExp(`/projects/${project.slug}/_uploads/photo\\.png$`));
    expect(fs.existsSync(stagedPath)).toBe(false);
    expect(fs.existsSync(res.body.mapping[stagedPath])).toBe(true);
  });

  it("reports missing paths instead of throwing", async () => {
    const project = await createProject({ name: "Test", theme: "arcade", mode: "light" });
    const ghost = path.join(tmp, "uploads-staging/nope/ghost.png");
    const res = await post(`/api/projects/${project.slug}/adopt-uploads`, { paths: [ghost] });
    expect(res.status).toBe(200);
    expect(res.body.missing).toEqual([ghost]);
    expect(res.body.mapping).toEqual({});
  });

  it("rejects paths outside the staging root", async () => {
    const project = await createProject({ name: "Test", theme: "arcade", mode: "light" });
    const escape = path.join(tmp, "../outside.png");
    const res = await post(`/api/projects/${project.slug}/adopt-uploads`, { paths: [escape] });
    expect(res.status).toBe(200);
    expect(res.body.missing).toEqual([escape]);
  });

  it("404s when the project does not exist", async () => {
    const res = await post(`/api/projects/nonexistent/adopt-uploads`, { paths: [] });
    expect(res.status).toBe(404);
  });
});
