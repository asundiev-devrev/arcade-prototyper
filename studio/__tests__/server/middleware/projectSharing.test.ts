import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

const ORIGINAL = process.env.ARCADE_STUDIO_ROOT;
let tmpDir: string;
let server: Server;
let port: number;

vi.mock("../../../server/secrets/keychain", () => ({
  getDevRevPat: async () => "host-pat",
}));

vi.mock("../../../server/relay/auth", () => ({
  resolveDevuFromPat: async () => ({ id: "don:.../devu/1", displayName: "Andrey" }),
}));

vi.mock("../../../server/devrev/dm", () => ({
  createOrFetchDm: vi.fn(async () => "dm-id"),
  postToDm: vi.fn(async () => {}),
}));

vi.mock("../../../server/relay/tunnel", () => ({
  acquireTunnel: vi.fn(async () => "https://example.trycloudflare.com"),
  releaseTunnel: vi.fn(async () => {}),
  currentTunnelUrl: () => "https://example.trycloudflare.com",
}));

vi.mock("../../../server/relay/persistence", () => ({
  loadProjects: async () => [],
  saveProjects: async () => {},
  loadSessions: async () => [],
  saveSessions: async () => {},
}));

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "studio-share-"));
  process.env.ARCADE_STUDIO_ROOT = tmpDir;
  // Ensure the project dir exists so multiplayer.json can be written.
  await import("node:fs/promises").then((fs) =>
    fs.mkdir(path.join(tmpDir, "projects", "my-proj"), { recursive: true }),
  );
  // Reset the project registry between tests.
  const { __resetProjectRegistryForTests } = await import(
    "../../../server/relay/projectRegistry"
  );
  __resetProjectRegistryForTests();
  const { projectSharingMiddleware } = await import(
    "../../../server/middleware/projectSharing"
  );
  server = createServer((req, res) => projectSharingMiddleware()(req, res, () => {
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

describe("projectSharing middleware", () => {
  it("POST /api/projects/:slug/collaborators adds a collaborator and posts a DM", async () => {
    const res = await call("POST", "/api/projects/my-proj/collaborators", {
      devu: "don:.../devu/2",
      displayName: "Bea",
    });
    expect(res.status).toBe(201);
    expect(res.body.projectShareId).toMatch(/^[0-9a-f]{8}-/);
    expect(res.body.inviteUrl).toContain("/project/");
  });

  it("GET /api/projects/:slug/collaborators returns shared_with list", async () => {
    await call("POST", "/api/projects/my-proj/collaborators", {
      devu: "don:.../devu/2",
      displayName: "Bea",
    });
    const res = await call("GET", "/api/projects/my-proj/collaborators");
    expect(res.status).toBe(200);
    expect(res.body.shared_with).toHaveLength(1);
    expect(res.body.shared_with[0].devu).toBe("don:.../devu/2");
  });

  it("DELETE /api/projects/:slug/collaborators/:devu removes a collaborator", async () => {
    await call("POST", "/api/projects/my-proj/collaborators", {
      devu: "don:.../devu/2",
      displayName: "Bea",
    });
    const res = await call("DELETE", "/api/projects/my-proj/collaborators/don:.../devu/2");
    expect(res.status).toBe(204);
    const list = await call("GET", "/api/projects/my-proj/collaborators");
    expect(list.body.shared_with).toEqual([]);
  });

  // Regression for 0.20.2: this middleware used to claim
  // `/api/projects/:slug/share`, which collided with the Cloudflare share
  // (frame deploy) endpoint and produced "Deploy failed: 400". The
  // collaborator routes must NOT match `/share`, so the request falls through
  // to cloudflareMiddleware.
  it("does NOT intercept POST /api/projects/:slug/share (cloudflare deploy route)", async () => {
    const res = await call("POST", "/api/projects/my-proj/share", {
      frameSlug: "hero",
    });
    expect(res.status).toBe(404); // fallthrough handler in beforeEach()
  });
});
