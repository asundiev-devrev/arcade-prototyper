import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { projectsMiddleware } from "../../../server/middleware/projects";
import { randomUUID } from "node:crypto";

let tmp: string; let server: http.Server; let port: number;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-chime-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  server = http.createServer(projectsMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("/api/projects/:slug/chime-ins", () => {
  it("GET returns empty array for project with no chime-ins", async () => {
    const c = await req("POST", "/api/projects", { name: "Test", theme: "arcade", mode: "light" });
    const slug = c.body.slug as string;

    const r = await req("GET", `/api/projects/${slug}/chime-ins`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it("GET returns only pending chime-ins", async () => {
    const c = await req("POST", "/api/projects", { name: "Test", theme: "arcade", mode: "light" });
    const slug = c.body.slug as string;

    // Seed three chime-ins: two pending, one dismissed
    const pendingId1 = `ci-${randomUUID()}`;
    const pendingId2 = `ci-${randomUUID()}`;
    const dismissedId = `ci-${randomUUID()}`;

    const pjPath = path.join(tmp, "projects", slug, "project.json");
    const pj = JSON.parse(fs.readFileSync(pjPath, "utf-8"));
    pj.chimeIns = [
      { id: pendingId1, frameSlug: "frame-1", objection: "Issue 1", createdAt: new Date().toISOString(), status: "pending" },
      { id: dismissedId, frameSlug: "frame-2", objection: "Issue 2", createdAt: new Date().toISOString(), status: "dismissed" },
      { id: pendingId2, frameSlug: "frame-3", objection: "Issue 3", createdAt: new Date().toISOString(), status: "pending" },
    ];
    fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2));

    const r = await req("GET", `/api/projects/${slug}/chime-ins`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
    expect(r.body.map((c: any) => c.id)).toEqual([pendingId1, pendingId2]);
    expect(r.body.every((c: any) => c.status === "pending")).toBe(true);
  });

  it("POST /:id/dismiss marks chime-in as dismissed", async () => {
    const c = await req("POST", "/api/projects", { name: "Test", theme: "arcade", mode: "light" });
    const slug = c.body.slug as string;

    const chimeId = `ci-${randomUUID()}`;
    const pjPath = path.join(tmp, "projects", slug, "project.json");
    const pj = JSON.parse(fs.readFileSync(pjPath, "utf-8"));
    pj.chimeIns = [
      { id: chimeId, frameSlug: "frame-1", objection: "Test issue", createdAt: new Date().toISOString(), status: "pending" },
    ];
    fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2));

    const dismissRes = await req("POST", `/api/projects/${slug}/chime-ins/${chimeId}/dismiss`);
    expect(dismissRes.status).toBe(204);
    expect(dismissRes.body).toBeNull();

    // Verify it's no longer in pending list
    const listRes = await req("GET", `/api/projects/${slug}/chime-ins`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toEqual([]);

    // Verify it was actually marked dismissed in the project
    const updated = JSON.parse(fs.readFileSync(pjPath, "utf-8"));
    expect(updated.chimeIns).toHaveLength(1);
    expect(updated.chimeIns[0].status).toBe("dismissed");
  });

  it("POST /:id/apply marks chime-in as applied", async () => {
    const c = await req("POST", "/api/projects", { name: "Test", theme: "arcade", mode: "light" });
    const slug = c.body.slug as string;

    const chimeId = `ci-${randomUUID()}`;
    const pjPath = path.join(tmp, "projects", slug, "project.json");
    const pj = JSON.parse(fs.readFileSync(pjPath, "utf-8"));
    pj.chimeIns = [
      { id: chimeId, frameSlug: "frame-1", objection: "Test issue", createdAt: new Date().toISOString(), status: "pending" },
    ];
    fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2));

    const applyRes = await req("POST", `/api/projects/${slug}/chime-ins/${chimeId}/apply`);
    expect(applyRes.status).toBe(204);
    expect(applyRes.body).toBeNull();

    // Verify it's no longer in pending list
    const listRes = await req("GET", `/api/projects/${slug}/chime-ins`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toEqual([]);

    // Verify it was actually marked applied in the project
    const updated = JSON.parse(fs.readFileSync(pjPath, "utf-8"));
    expect(updated.chimeIns).toHaveLength(1);
    expect(updated.chimeIns[0].status).toBe("applied");
  });

  it("POST /:id/dismiss returns 404 when project not found", async () => {
    const r = await req("POST", "/api/projects/nonexistent/chime-ins/ci-123/dismiss");
    expect(r.status).toBe(404);
    expect(r.body.error.message).toBe("Project not found");
  });

  it("POST /:id/apply returns 404 when project not found", async () => {
    const r = await req("POST", "/api/projects/nonexistent/chime-ins/ci-123/apply");
    expect(r.status).toBe(404);
    expect(r.body.error.message).toBe("Project not found");
  });

  it("POST /:id/dismiss handles non-existent chime-in gracefully", async () => {
    // dismissChimeIn is a pure map; dismissing an id that doesn't exist is a no-op
    const c = await req("POST", "/api/projects", { name: "Test", theme: "arcade", mode: "light" });
    const slug = c.body.slug as string;

    const r = await req("POST", `/api/projects/${slug}/chime-ins/nonexistent/dismiss`);
    expect(r.status).toBe(204);
  });
});
