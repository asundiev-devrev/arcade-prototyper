import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { projectsMiddleware } from "../../../server/middleware/projects";

let tmp: string;
let server: http.Server;
let port: number;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-dev-"));
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

async function req(method: string, urlPath: string, body?: unknown) {
  const res = await fetch(`http://localhost:${port}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function createSampleProject(): Promise<string> {
  const r = await req("POST", "/api/projects", { name: "Sample", theme: "arcade", mode: "light" });
  return r.body.slug as string;
}

describe("GET /api/projects/:slug/tree", () => {
  it("returns an array of entries including directories with trailing slash", async () => {
    const slug = await createSampleProject();
    const r = await req("GET", `/api/projects/${slug}/tree`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    const entries = r.body as string[];
    expect(entries).toContain("project.json");
    expect(entries).toContain("CLAUDE.md");
    expect(entries).toContain("theme-overrides.css");
    expect(entries).toContain("frames/");
    expect(entries).toContain("shared/");
    expect(entries).toContain("chat-history.json");
  });

  it("excludes dotfiles, thumbnails, and _uploads", async () => {
    const slug = await createSampleProject();
    const projDir = path.join(tmp, "projects", slug);
    fs.writeFileSync(path.join(projDir, ".hidden"), "secret");
    fs.mkdirSync(path.join(projDir, "_uploads"), { recursive: true });
    fs.writeFileSync(path.join(projDir, "_uploads", "x.png"), "");
    // thumbnails dir already exists
    fs.writeFileSync(path.join(projDir, "thumbnails", "a.png"), "");

    const r = await req("GET", `/api/projects/${slug}/tree`);
    expect(r.status).toBe(200);
    const entries = r.body as string[];
    expect(entries.some((e) => e.startsWith(".hidden"))).toBe(false);
    expect(entries.some((e) => e.startsWith("thumbnails"))).toBe(false);
    expect(entries.some((e) => e.startsWith("_uploads"))).toBe(false);
  });
});

describe("GET /api/projects/:slug/file", () => {
  it("returns file content for a text file", async () => {
    const slug = await createSampleProject();
    const r = await req("GET", `/api/projects/${slug}/file?path=CLAUDE.md`);
    expect(r.status).toBe(200);
    expect(typeof r.body.content).toBe("string");
    expect(r.body.content).toContain("Sample");
  });

  it("rejects path escape attempts with 400", async () => {
    const slug = await createSampleProject();
    const r = await req(
      "GET",
      `/api/projects/${slug}/file?path=${encodeURIComponent("../../../etc/passwd")}`,
    );
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/Path escape/);
  });

  it("rejects sibling-prefix path escape attempts", async () => {
    // Create a project with a name that forms a prefix of another dir name
    const c1 = await req("POST", "/api/projects", { name: "Foo", theme: "arcade", mode: "light" });
    const slug1 = c1.body.slug as string;
    // Create a sibling directory that begins with the same prefix
    const evilDir = path.join(tmp, "projects", slug1 + "-evil");
    fs.mkdirSync(evilDir, { recursive: true });
    fs.writeFileSync(path.join(evilDir, "secret.txt"), "leaked");

    const r = await req(
      "GET",
      `/api/projects/${slug1}/file?path=${encodeURIComponent("../" + slug1 + "-evil/secret.txt")}`,
    );
    expect(r.status).toBe(400);
  });

  it("returns 400 when path query is missing", async () => {
    const slug = await createSampleProject();
    const r = await req("GET", `/api/projects/${slug}/file`);
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/path/);
  });

  it("returns placeholder for non-text files", async () => {
    const slug = await createSampleProject();
    const projDir = path.join(tmp, "projects", slug);
    fs.writeFileSync(path.join(projDir, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const r = await req("GET", `/api/projects/${slug}/file?path=image.png`);
    expect(r.status).toBe(200);
    expect(r.body.content).toMatch(/\[non-text file/);
  });

  it("returns size-cap placeholder for text files over 1 MB", async () => {
    const slug = await createSampleProject();
    const projDir = path.join(tmp, "projects", slug);
    // 1.5 MB markdown file
    const big = "x".repeat(1.5 * 1024 * 1024);
    fs.writeFileSync(path.join(projDir, "big.md"), big);

    const r = await req("GET", `/api/projects/${slug}/file?path=big.md`);
    expect(r.status).toBe(200);
    expect(r.body.content).toMatch(/\[binary\/large file omitted: \d+ bytes\]/);
  });
});

describe("POST /api/projects/:slug/reveal", () => {
  it("returns 404 when slug does not exist", async () => {
    const r = await req("POST", "/api/projects/does-not-exist/reveal");
    expect(r.status).toBe(404);
    expect(r.body.error.message).toMatch(/not found/i);
  });
});
