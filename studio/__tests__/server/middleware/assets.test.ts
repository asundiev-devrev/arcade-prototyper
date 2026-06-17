// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { assetsMiddleware } from "../../../server/middleware/assets";

let server: http.Server;
let port: number;

beforeEach(async () => {
  const mw = assetsMiddleware();
  // Wrap so that a fall-through (next()) writes a sentinel body we can assert on.
  server = http.createServer((req, res) => {
    mw(req, res, () => {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("passthrough");
    });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
});

async function get(pathname: string) {
  return new Promise<{ status: number; contentType: string; body: Buffer }>((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          contentType: String(res.headers["content-type"] ?? ""),
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on("error", reject);
  });
}

describe("assetsMiddleware", () => {
  it("GET /api/assets serves the committed catalog with all three section kinds", async () => {
    const res = await get("/api/assets");
    expect(res.status).toBe(200);
    expect(res.contentType).toMatch(/application\/json/);
    const parsed = JSON.parse(res.body.toString("utf8"));
    expect(Array.isArray(parsed.sections)).toBe(true);
    const kinds = parsed.sections.map((s: any) => s.kind);
    expect(kinds).toEqual(expect.arrayContaining(["composite", "component", "icon"]));
  });

  it("GET /api/assets/thumbs/FormModal.png serves a PNG with a non-empty body", async () => {
    const res = await get("/api/assets/thumbs/FormModal.png");
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("image/png");
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("GET /api/assets/thumbs/Separator.png 404s (opted-out, no PNG file)", async () => {
    const res = await get("/api/assets/thumbs/Separator.png");
    expect(res.status).toBe(404);
    const parsed = JSON.parse(res.body.toString("utf8"));
    expect(parsed).toEqual({ error: "thumb_not_found" });
  });

  it("blocks path-traversal: encoded ../ does not escape the thumbs dir", async () => {
    // %2f decodes to "/" — the route regex forbids separators, so this must
    // NOT serve package.json (or any file outside the thumbs dir). It falls
    // through to the sentinel passthrough handler.
    const res = await get("/api/assets/thumbs/..%2f..%2fpackage.png");
    expect(res.status).toBe(404);
    expect(res.body.toString("utf8")).toBe("passthrough");
  });

  it("blocks path-traversal: a slash in the name does not match the route", async () => {
    const res = await get("/api/assets/thumbs/foo/bar.png");
    expect(res.status).toBe(404);
    expect(res.body.toString("utf8")).toBe("passthrough");
  });

  it("GET /api/other calls next() (pass-through)", async () => {
    const res = await get("/api/other");
    expect(res.status).toBe(404);
    expect(res.body.toString("utf8")).toBe("passthrough");
  });
});
