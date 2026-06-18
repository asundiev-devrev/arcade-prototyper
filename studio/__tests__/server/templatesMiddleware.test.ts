import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { templatesMiddleware } from "../../server/middleware/templates";

function mockReq(method: string, url: string): IncomingMessage {
  const stream = new PassThrough();
  stream.end();
  return Object.assign(stream, { method, url }) as unknown as IncomingMessage;
}
function mockRes() {
  let status = 0; let headers: Record<string, any> = {}; const chunks: Buffer[] = [];
  const res = {
    writeHead(s: number, h?: Record<string, any>) { status = s; if (h) headers = h; return res; },
    setHeader(k: string, v: any) { headers[k] = v; },
    end(chunk?: any) { if (chunk) chunks.push(Buffer.from(chunk)); },
  } as unknown as ServerResponse;
  return { res, get status() { return status; }, get headers() { return headers; }, get bytes() { return Buffer.concat(chunks); } };
}

describe("templatesMiddleware", () => {
  it("GET /api/templates returns the manifest", async () => {
    const out = mockRes();
    await templatesMiddleware()(mockReq("GET", "/api/templates"), out.res, () => {});
    expect(out.status).toBe(200);
    const list = JSON.parse(out.bytes.toString());
    expect(list.map((t: any) => t.id).sort()).toEqual(["app-list", "computer", "settings-page"]);
  });

  it("GET /api/templates/:id/thumb streams a PNG", async () => {
    const out = mockRes();
    await templatesMiddleware()(mockReq("GET", "/api/templates/computer/thumb"), out.res, () => {});
    expect(out.status).toBe(200);
    expect(String(out.headers["Content-Type"])).toContain("image/png");
    expect(out.bytes.length).toBeGreaterThan(100);
  });

  it("GET /api/templates/:id/thumb returns 404 for an unknown id", async () => {
    const out = mockRes();
    await templatesMiddleware()(mockReq("GET", "/api/templates/bogus/thumb"), out.res, () => {});
    expect(out.status).toBe(404);
  });

  // Freshness guard: every manifest entry must have a committed PNG, so
  // "added a template, forgot to run studio:templates" fails CI, not the user.
  it("serves a committed thumbnail for EVERY template in the manifest", async () => {
    const { TEMPLATES } = await import("../../server/templates");
    for (const t of TEMPLATES) {
      const out = mockRes();
      await templatesMiddleware()(mockReq("GET", `/api/templates/${t.id}/thumb`), out.res, () => {});
      expect(out.status, `${t.id} thumbnail missing — run pnpm run studio:templates`).toBe(200);
      expect(out.bytes.length).toBeGreaterThan(100);
    }
  });

  it("passes through non-template URLs", async () => {
    let nexted = false;
    await templatesMiddleware()(mockReq("GET", "/api/projects"), mockRes().res, () => { nexted = true; });
    expect(nexted).toBe(true);
  });
});
