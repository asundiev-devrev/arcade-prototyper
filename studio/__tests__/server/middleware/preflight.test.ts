// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import { preflightMiddleware } from "../../../server/middleware/preflight";
import * as firstRun from "../../../server/firstRun";

let server: http.Server;
let port: number;

beforeEach(async () => {
  firstRun.resetEnsureDepsCache();
  vi.spyOn(firstRun, "ensureDeps").mockResolvedValue({ ok: true, missing: [] });
  // Compose the middleware with a simple fallback so we can assert that
  // non-matching requests fall through (middleware calls next()).
  server = http.createServer((req, res) => {
    const mw = preflightMiddleware();
    mw(req, res, () => {
      res.writeHead(418, { "Content-Type": "text/plain" });
      res.end("fell through");
    });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  vi.restoreAllMocks();
  server.close();
  firstRun.resetEnsureDepsCache();
});

describe("/api/preflight", () => {
  it("returns 200 + JSON {ok, missing} on GET", async () => {
    const res = await fetch(`http://localhost:${port}/api/preflight`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toEqual({ ok: true, missing: [] });
  });

  it("reports missing deps verbatim from ensureDeps", async () => {
    (firstRun.ensureDeps as any).mockResolvedValueOnce({
      ok: false,
      missing: ["pnpm", "figmanage"],
    });
    const res = await fetch(`http://localhost:${port}/api/preflight`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, missing: ["pnpm", "figmanage"] });
  });

  it("falls through to next() on wrong method", async () => {
    const res = await fetch(`http://localhost:${port}/api/preflight`, {
      method: "POST",
    });
    expect(res.status).toBe(418);
    expect(await res.text()).toBe("fell through");
  });

  it("falls through to next() on unrelated URL", async () => {
    const res = await fetch(`http://localhost:${port}/api/other`);
    expect(res.status).toBe(418);
    expect(await res.text()).toBe("fell through");
  });

  it("returns 500 JSON when ensureDeps rejects", async () => {
    (firstRun.ensureDeps as any).mockRejectedValueOnce(new Error("boom"));
    const res = await fetch(`http://localhost:${port}/api/preflight`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("preflight_failed");
    expect(body.error.message).toBe("boom");
  });
});
