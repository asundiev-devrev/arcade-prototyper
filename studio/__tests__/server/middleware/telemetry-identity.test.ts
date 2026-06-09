import { describe, it, expect } from "vitest";
import { telemetryIdentityMiddleware, __setIdentitySnapshot } from "../../../server/middleware/telemetryIdentity";
import type { IncomingMessage, ServerResponse } from "node:http";

function mockRes() {
  const chunks: string[] = []; let status = 0;
  return { writeHead(s: number) { status = s; }, end(b?: string) { if (b) chunks.push(b); },
    get status() { return status; }, get body() { return chunks.join(""); } } as unknown as ServerResponse & { status: number; body: string };
}

describe("telemetry identity endpoint", () => {
  it("returns the cached identity snapshot", async () => {
    __setIdentitySnapshot({ distinctId: "u1", sessionId: "s1", version: "0.30.0", os: "darwin-arm64", config: { enabled: false, debug: true, posthogHost: "h" } });
    const res = mockRes() as any; let nextCalled = false;
    await telemetryIdentityMiddleware()({ url: "/api/telemetry/identity", method: "GET" } as IncomingMessage, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).distinctId).toBe("u1");
  });
  it("passes through unrelated urls", async () => {
    const res = mockRes() as any; let nextCalled = false;
    await telemetryIdentityMiddleware()({ url: "/api/other", method: "GET" } as IncomingMessage, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});
