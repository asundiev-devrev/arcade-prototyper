import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

const ORIGINAL = process.env.ARCADE_STUDIO_ROOT;
let tmpDir: string;
let server: Server;
let port: number;

vi.mock("../../../server/sharedProjects/relayClient", () => ({
  connectMirror: vi.fn(async () => {}),
  disconnectMirror: vi.fn(async () => {}),
  sendComment: vi.fn(async () => {}),
  getMirrorBus: () => ({ on: () => {}, off: () => {} }),
}));

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "studio-sp-"));
  process.env.ARCADE_STUDIO_ROOT = tmpDir;
  const { sharedProjectsMiddleware } = await import(
    "../../../server/middleware/sharedProjects"
  );
  server = createServer((req, res) => sharedProjectsMiddleware()(req, res, () => {
    res.writeHead(404);
    res.end();
  }));
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  if (ORIGINAL) process.env.ARCADE_STUDIO_ROOT = ORIGINAL;
  else delete process.env.ARCADE_STUDIO_ROOT;
  await rm(tmpDir, { recursive: true, force: true });
});

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(`http://localhost:${port}${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("sharedProjects middleware", () => {
  it("POST /api/shared-projects/import creates a mirror entry", async () => {
    const res = await call("POST", "/api/shared-projects/import", {
      projectShareId: "abc",
      relayUrl: "wss://x.trycloudflare.com/api/multiplayer/ws",
      hostDevu: "don:.../devu/1",
      hostDisplayName: "Andrey",
      projectSlug: "p",
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("abc");
  });

  it("GET /api/shared-projects returns the list", async () => {
    await call("POST", "/api/shared-projects/import", {
      projectShareId: "abc",
      relayUrl: "x",
      hostDevu: "h",
      hostDisplayName: "A",
      projectSlug: "p",
    });
    const res = await call("GET", "/api/shared-projects");
    expect(res.status).toBe(200);
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.projects[0].id).toBe("abc");
  });

  it("POST /api/shared-projects/:id/comment returns 200 even when offline", async () => {
    await call("POST", "/api/shared-projects/import", {
      projectShareId: "abc",
      relayUrl: "x",
      hostDevu: "h",
      hostDisplayName: "A",
      projectSlug: "p",
    });
    const res = await call("POST", "/api/shared-projects/abc/comment", { text: "hi" });
    expect(res.status).toBe(200);
  });

  it("DELETE /api/shared-projects/:id removes the mirror", async () => {
    await call("POST", "/api/shared-projects/import", {
      projectShareId: "abc",
      relayUrl: "x",
      hostDevu: "h",
      hostDisplayName: "A",
      projectSlug: "p",
    });
    const res = await call("DELETE", "/api/shared-projects/abc");
    expect(res.status).toBe(204);
    const list = await call("GET", "/api/shared-projects");
    expect(list.body.projects).toEqual([]);
  });
});
