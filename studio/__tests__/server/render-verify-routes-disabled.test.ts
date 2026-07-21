import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import { chatMiddleware } from "../../server/middleware/chat";
import { getTurn, __resetTurnRegistryForTests } from "../../server/turnRegistry";

/**
 * Whole-branch review finding: the render-measurement features (visual-noop,
 * render-verify v2/v3) are disabled on the CLIENT, but their server routes
 * stayed live — each POST spawned a real claude turn / ran esbuild from an
 * unauthenticated localhost POST, reachable by a same-origin generated frame.
 * With RENDER_VERIFY_SERVER_ENABLED=false these routes must be inert: 404, and
 * critically NO turn is spawned. This test pins that invariant so a future
 * re-enable is a deliberate flag flip, not an accident.
 */
async function post(url: string, body?: unknown): Promise<{ status: number }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status };
}
async function get(url: string): Promise<{ status: number }> {
  const res = await fetch(url, { method: "GET" });
  return { status: res.status };
}

describe("render-verify routes are inert while disabled", () => {
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

  it("POST /api/chat/render-verify-retry → 404 and spawns NO turn", async () => {
    const { status } = await post(`${baseUrl}/api/chat/render-verify-retry`, {
      slug: "alpha", frame: "01-x", userTurnId: "t1", prompt: "do something invisible",
    });
    expect(status).toBe(404);
    expect(getTurn("alpha")).toBeUndefined(); // the whole point: no invisible turn
  });

  it("POST /api/chat/visual-noop-retry → 404 and spawns NO turn", async () => {
    const { status } = await post(`${baseUrl}/api/chat/visual-noop-retry`, {
      slug: "beta", frame: "01-x", userTurnId: "t2",
    });
    expect(status).toBe(404);
    expect(getTurn("beta")).toBeUndefined();
  });

  it("POST /api/verify-render → 404 (no esbuild/temp-copy work)", async () => {
    const { status } = await post(`${baseUrl}/api/verify-render`, {
      slug: "gamma", frame: "01-x", targetPage: "pages/Preferences.tsx", which: "after",
    });
    expect(status).toBe(404);
  });

  it("GET /api/chat/last-turn-meta/:slug → 404 (dead store)", async () => {
    const { status } = await get(`${baseUrl}/api/chat/last-turn-meta/alpha`);
    expect(status).toBe(404);
  });

  it("still routes a normal POST /api/chat past the gate (does not 404 everything)", async () => {
    // A malformed start body should reach handleStart and fail on ITS terms
    // (not the render-verify 404) — proves the gate is scoped to the RV routes.
    const { status } = await post(`${baseUrl}/api/chat`, { nonsense: true });
    expect(status).not.toBe(404);
  });
});
