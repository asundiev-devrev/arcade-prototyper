import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { projectsMiddleware } from "../../../server/middleware/projects";

let tmp: string; let server: http.Server; let port: number;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-mw-"));
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

// createProject seeds frames/00-computer-reference/ as a designer-facing
// starter. Tests that assert on hand-crafted frame fixtures need to drop it
// first so reconcile output matches what the test wrote.
function clearSeededFrames(slug: string): void {
  const framesDir = path.join(tmp, "projects", slug, "frames");
  for (const entry of fs.readdirSync(framesDir, { withFileTypes: true })) {
    if (entry.isDirectory()) fs.rmSync(path.join(framesDir, entry.name), { recursive: true, force: true });
  }
}

describe("/api/projects", () => {
  it("POST creates a project", async () => {
    const r = await req("POST", "/api/projects", { name: "X", theme: "arcade", mode: "light" });
    expect(r.status).toBe(201);
    expect(r.body.slug).toBe("x");
  });

  it("GET lists projects", async () => {
    await req("POST", "/api/projects", { name: "A", theme: "arcade", mode: "light" });
    const r = await req("GET", "/api/projects");
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
  });

  it("PATCH renames", async () => {
    const c = await req("POST", "/api/projects", { name: "A", theme: "arcade", mode: "light" });
    const r = await req("PATCH", `/api/projects/${c.body.slug}`, { name: "B" });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe("B");
  });

  it("DELETE removes", async () => {
    const c = await req("POST", "/api/projects", { name: "A", theme: "arcade", mode: "light" });
    const r = await req("DELETE", `/api/projects/${c.body.slug}`);
    expect(r.status).toBe(204);
  });

  it("GET /:slug self-heals frames that exist on disk but are missing from project.json", async () => {
    // Simulates the bug beta testers hit: chokidar missed the fs event for a
    // frame Claude just wrote, so project.json stayed stale and the UI showed
    // EmptyViewport. The GET handler should reconcile before responding.
    const c = await req("POST", "/api/projects", { name: "A", theme: "arcade", mode: "light" });
    const slug = c.body.slug as string;
    clearSeededFrames(slug);
    const frameDir = path.join(tmp, "projects", slug, "frames", "01-orphan");
    fs.mkdirSync(frameDir, { recursive: true });
    fs.writeFileSync(path.join(frameDir, "index.tsx"), "export default function F() { return null; }");

    const r = await req("GET", `/api/projects/${slug}`);
    expect(r.status).toBe(200);
    expect(r.body.frames.map((f: any) => f.slug)).toEqual(["01-orphan"]);

    const pj = JSON.parse(
      fs.readFileSync(path.join(tmp, "projects", slug, "project.json"), "utf-8"),
    );
    expect(pj.frames.map((f: any) => f.slug)).toEqual(["01-orphan"]);
  });

  it("GET / self-heals orphaned frames across all projects", async () => {
    const a = await req("POST", "/api/projects", { name: "A", theme: "arcade", mode: "light" });
    const b = await req("POST", "/api/projects", { name: "B", theme: "arcade", mode: "light" });
    for (const slug of [a.body.slug, b.body.slug]) {
      clearSeededFrames(slug);
      const d = path.join(tmp, "projects", slug, "frames", "orphan");
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "index.tsx"), "export default () => null;");
    }

    const r = await req("GET", "/api/projects");
    expect(r.status).toBe(200);
    for (const p of r.body) {
      expect(p.frames.map((f: any) => f.slug)).toEqual(["orphan"]);
    }
  });
});

describe("/api/projects/:slug/frames/:frame", () => {
  async function createProjectWithFrame(frameSlug: string) {
    const c = await req("POST", "/api/projects", { name: "A", theme: "arcade", mode: "light" });
    const slug = c.body.slug as string;
    const framesDir = path.join(tmp, "projects", slug, "frames", frameSlug);
    fs.mkdirSync(framesDir, { recursive: true });
    fs.writeFileSync(path.join(framesDir, "index.tsx"), "export default function Frame() { return null; }");
    // Persist the frame entry in project.json so PATCH/DELETE can find it.
    const pjPath = path.join(tmp, "projects", slug, "project.json");
    const pj = JSON.parse(fs.readFileSync(pjPath, "utf-8"));
    pj.frames = [
      { slug: frameSlug, name: "Frame A", createdAt: new Date().toISOString(), size: "1440" },
    ];
    fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2));
    return slug;
  }

  it("PATCH updates frame size", async () => {
    const slug = await createProjectWithFrame("home");
    const r = await req("PATCH", `/api/projects/${slug}/frames/home`, { size: "1024" });
    expect(r.status).toBe(200);
    const frame = r.body.frames.find((f: any) => f.slug === "home");
    expect(frame.size).toBe("1024");

    const pj = JSON.parse(
      fs.readFileSync(path.join(tmp, "projects", slug, "project.json"), "utf-8"),
    );
    expect(pj.frames.find((f: any) => f.slug === "home").size).toBe("1024");
  });

  it("PATCH renames frame", async () => {
    const slug = await createProjectWithFrame("home");
    const r = await req("PATCH", `/api/projects/${slug}/frames/home`, { name: "Renamed" });
    expect(r.status).toBe(200);
    const frame = r.body.frames.find((f: any) => f.slug === "home");
    expect(frame.name).toBe("Renamed");
  });

  it("PATCH ignores non-allowed fields like slug and createdAt", async () => {
    const slug = await createProjectWithFrame("home");
    const r = await req("PATCH", `/api/projects/${slug}/frames/home`, {
      size: "1024",
      slug: "hacked",
      createdAt: "1999-01-01T00:00:00.000Z",
    });
    expect(r.status).toBe(200);
    const frame = r.body.frames.find((f: any) => f.slug === "home");
    expect(frame).toBeDefined();
    expect(frame.slug).toBe("home");
    expect(frame.createdAt).not.toBe("1999-01-01T00:00:00.000Z");
    expect(r.body.frames.find((f: any) => f.slug === "hacked")).toBeUndefined();
  });

  it("DELETE removes frame from project.json and from disk", async () => {
    const slug = await createProjectWithFrame("home");
    const framePath = path.join(tmp, "projects", slug, "frames", "home");
    expect(fs.existsSync(framePath)).toBe(true);

    const r = await req("DELETE", `/api/projects/${slug}/frames/home`);
    expect(r.status).toBe(200);
    expect(r.body.frames.find((f: any) => f.slug === "home")).toBeUndefined();
    expect(fs.existsSync(framePath)).toBe(false);
  });

  it("PATCH returns 404 when project does not exist", async () => {
    const r = await req("PATCH", "/api/projects/nope/frames/home", { size: "1024" });
    expect(r.status).toBe(404);
  });

  it("PATCH returns 404 when frame does not exist", async () => {
    const slug = await createProjectWithFrame("home");
    const r = await req("PATCH", `/api/projects/${slug}/frames/nonexistent`, { size: "1024" });
    expect(r.status).toBe(404);
    expect(r.body.error.message).toBe("Frame not found");
  });

  it("DELETE returns 404 when frame does not exist", async () => {
    const slug = await createProjectWithFrame("home");
    const r = await req("DELETE", `/api/projects/${slug}/frames/nonexistent`);
    expect(r.status).toBe(404);
    expect(r.body.error.message).toBe("Frame not found");
  });
});

describe("/api/projects subresource routing", () => {
  // Regression guard: a user clicked "Copy Lift Manifest" in the Share
  // modal, which hits GET /api/projects/<slug>/lift/<frame>.md. The
  // earlier projectsMiddleware used a greedy catch-all that matched any
  // URL of the form /api/projects/<slug>/..., extracted the slug, and
  // returned project.json — clobbering sibling middlewares like
  // liftMiddleware and thumbnailsMiddleware. The clipboard then contained
  // the project's JSON metadata instead of the manifest.
  //
  // The fix: projectsMiddleware only handles /api/projects and
  // /api/projects/<slug> exactly; anything deeper falls through to the
  // next middleware via next().
  it("falls through on unrecognized subresources instead of returning project.json", async () => {
    const c = await req("POST", "/api/projects", { name: "A", theme: "arcade", mode: "light" });
    const slug = c.body.slug as string;

    // Composed chain: projectsMiddleware then a sentinel downstream
    // middleware. A correct projectsMiddleware must invoke next() for
    // /api/projects/<slug>/lift/... so the sentinel runs.
    const composedServer = http.createServer((reqNode, resNode) => {
      void (projectsMiddleware() as any)(reqNode, resNode, () => {
        resNode.writeHead(200, { "Content-Type": "application/json" });
        resNode.end(JSON.stringify({ downstream: true }));
      });
    });
    await new Promise<void>((r) => composedServer.listen(0, () => r()));
    const composedPort = (composedServer.address() as any).port;

    try {
      const res = await fetch(
        `http://localhost:${composedPort}/api/projects/${slug}/lift/some-frame.md`,
      );
      const body = await res.json();
      expect(body).toEqual({ downstream: true });
    } finally {
      await new Promise<void>((r) => composedServer.close(() => r()));
    }
  });

  it("still handles the exact /api/projects/:slug GET route", async () => {
    const c = await req("POST", "/api/projects", { name: "A", theme: "arcade", mode: "light" });
    const slug = c.body.slug as string;
    const r = await req("GET", `/api/projects/${slug}`);
    expect(r.status).toBe(200);
    expect(r.body.slug).toBe(slug);
  });
});
