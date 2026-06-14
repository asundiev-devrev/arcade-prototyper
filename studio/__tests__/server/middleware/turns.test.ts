// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { turnsMiddleware } from "../../../server/middleware/turns";
import { startTurn, __resetTurnRegistryForTests } from "../../../server/turnRegistry";

let server: http.Server;
let port: number;

beforeEach(async () => {
  __resetTurnRegistryForTests();
  server = http.createServer((req, res) => {
    turnsMiddleware()(req, res, () => {
      res.writeHead(404);
      res.end("not handled");
    });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});
afterEach(() => {
  server.close();
  __resetTurnRegistryForTests();
});

async function get(path: string) {
  const res = await fetch(`http://localhost:${port}${path}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("GET /api/turns/active", () => {
  it("returns active:false when idle", async () => {
    const r = await get("/api/turns/active");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ active: false });
  });

  it("returns active:true while a turn runs", async () => {
    startTurn("p", { prompt: "x", run: () => { /* never ends */ } });
    const r = await get("/api/turns/active");
    expect(r.body).toEqual({ active: true });
  });

  it("passes non-matching routes to next()", async () => {
    const r = await get("/api/something-else");
    expect(r.status).toBe(404);
  });
});
