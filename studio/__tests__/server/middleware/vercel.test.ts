import { describe, it, expect, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

vi.mock("esbuild", () => ({
  build: vi.fn(async () => ({
    outputFiles: [
      { path: "/test.js", text: "console.log('test');" },
      { path: "/test.css", text: "body { margin: 0; }" },
    ],
  })),
}));

describe("vercelMiddleware", () => {
  it("should pass through non-matching routes", async () => {
    const { vercelMiddleware } = await import("../../../server/middleware/vercel");
    const middleware = vercelMiddleware();
    const req = { url: "/api/projects", method: "GET" } as IncomingMessage;
    const res = {} as ServerResponse;
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("should handle missing frameSlug", async () => {
    const { vercelMiddleware } = await import("../../../server/middleware/vercel");
    const middleware = vercelMiddleware();
    const req = {
      url: "/api/projects/test-project/share",
      method: "POST",
      [Symbol.asyncIterator]: async function* () {
        yield JSON.stringify({});
      },
    } as any;

    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as any;

    await middleware(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(400, { "Content-Type": "application/json" });
    expect(res.end).toHaveBeenCalled();
  });
});
