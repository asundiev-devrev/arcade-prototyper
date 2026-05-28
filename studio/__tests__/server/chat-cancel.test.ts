import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import { chatMiddleware } from "../../server/middleware/chat";
import {
  startTurn,
  getTurn,
  __resetTurnRegistryForTests,
} from "../../server/turnRegistry";

async function postJson(url: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { method: "POST" });
  let body: any;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

describe("POST /api/chat/cancel/:slug", () => {
  let baseUrl: string;
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    __resetTurnRegistryForTests();
    server = createServer((req, res) => {
      void chatMiddleware()(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const addr = server.address();
    baseUrl = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("returns 200 + cancelled:true when a turn is running", async () => {
    startTurn("alpha", { prompt: "hi", run: () => { /* hangs */ } });
    const { status, body } = await postJson(`${baseUrl}/api/chat/cancel/alpha`);
    expect(status).toBe(200);
    expect(body.cancelled).toBe(true);
    expect(getTurn("alpha")?.status).toBe("cancelled");
  });

  it("returns 409 when no turn is running for that slug", async () => {
    const { status, body } = await postJson(`${baseUrl}/api/chat/cancel/nope`);
    expect(status).toBe(409);
    expect(body.error.code).toBe("no_running_turn");
  });
});
