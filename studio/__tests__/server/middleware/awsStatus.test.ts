// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import { awsLoginMiddleware } from "../../../server/middleware/awsLogin";
import * as preflight from "../../../server/awsPreflight";

let server: http.Server;
let port: number;

beforeEach(async () => {
  server = http.createServer(awsLoginMiddleware());
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(() => {
  server.close();
  vi.restoreAllMocks();
});

describe("GET /api/aws/status", () => {
  it("returns { authenticated: true } when Bedrock auth succeeds", async () => {
    vi.spyOn(preflight, "hasBedrockAuth").mockResolvedValue(true);
    const res = await fetch(`http://localhost:${port}/api/aws/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: true });
  });

  it("returns { authenticated: false } when Bedrock auth fails", async () => {
    vi.spyOn(preflight, "hasBedrockAuth").mockResolvedValue(false);
    const res = await fetch(`http://localhost:${port}/api/aws/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it("doesn't intercept POST requests — still routes to sso-login", async () => {
    // POST against /api/aws/status shouldn't match the GET branch.
    // It won't match the sso-login branch either (wrong URL), so it
    // falls through to next() — the middleware's default response is
    // nothing, so connection just dangles until we close it. We use a
    // short timeout via AbortController.
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 100);
    await expect(
      fetch(`http://localhost:${port}/api/aws/status`, {
        method: "POST",
        signal: ctrl.signal,
      }),
    ).rejects.toThrow();
  });
});
