import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { projectsMiddleware } from "../../server/middleware/projects";
import { createProject } from "../../server/projects";

let tmpRoot: string;
beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tpl-route-"));
  process.env.ARCADE_STUDIO_ROOT = tmpRoot;
});
afterEach(async () => {
  delete process.env.ARCADE_STUDIO_ROOT;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function mockReq(method: string, url: string, body?: unknown): IncomingMessage {
  const stream = new PassThrough();
  if (body !== undefined) stream.end(JSON.stringify(body));
  else stream.end();
  return Object.assign(stream, { method, url }) as unknown as IncomingMessage;
}

function mockRes() {
  let status = 0;
  let payload = "";
  const res = {
    writeHead(s: number) { status = s; return res; },
    end(chunk?: string) { if (chunk) payload += chunk; },
  } as unknown as ServerResponse;
  return { res, get status() { return status; }, get body() { return payload ? JSON.parse(payload) : undefined; } };
}

describe("POST /api/projects/:slug/seed-template", () => {
  it("seeds the frame and returns 201", async () => {
    const p = await createProject({ name: "Computer Settings", theme: "arcade", mode: "light" });
    const mw = projectsMiddleware();
    const out = mockRes();
    await mw(mockReq("POST", `/api/projects/${p.slug}/seed-template`, { templateId: "computer-settings" }), out.res);
    expect(out.status).toBe(201);
    expect(out.body.slug).toBe("01-computer-settings");
  });

  it("returns 404 for an unknown template id", async () => {
    const p = await createProject({ name: "X", theme: "arcade", mode: "light" });
    const mw = projectsMiddleware();
    const out = mockRes();
    await mw(mockReq("POST", `/api/projects/${p.slug}/seed-template`, { templateId: "bogus" }), out.res);
    expect(out.status).toBe(404);
  });
});
