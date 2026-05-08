import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const getDevRevPatMock = vi.fn<() => Promise<string | null>>();

vi.mock("../../../server/secrets/keychain", () => ({
  getDevRevPat: () => getDevRevPatMock(),
}));

vi.mock("../../../server/relay/auth", () => ({
  resolveDevuFromPat: async (pat: string) => {
    if (pat === "host-pat") return { id: "devu/HOST", displayName: "Host" };
    if (pat === "guest-pat") return { id: "devu/GUEST", displayName: "Guest" };
    return null;
  },
}));

const {
  multiplayerMiddleware,
} = await import("../../../server/middleware/multiplayer");
const {
  __resetSessionRegistryForTests,
  listSessions,
  getSession,
} = await import("../../../server/relay/sessionRegistry");

function req(url: string, method: string, body?: any, headers: Record<string, string> = {}): IncomingMessage {
  const payload = body ? JSON.stringify(body) : "";
  return {
    url, method, headers,
    [Symbol.asyncIterator]: async function* () {
      if (payload) yield payload;
    },
  } as any;
}

function res(): ServerResponse & { _status?: number; _body?: string } {
  return {
    _status: undefined,
    _body: undefined,
    writeHead(status: number) { this._status = status; },
    end(b?: string) { this._body = b; },
  } as any;
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-mp-mw-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  __resetSessionRegistryForTests();
  getDevRevPatMock.mockResolvedValue("host-pat");
});
afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("multiplayer middleware", () => {
  it("POST /api/multiplayer/sessions creates a session with the host's devu", async () => {
    const mw = multiplayerMiddleware();
    const request = req("/api/multiplayer/sessions", "POST", { projectSlug: "demo" });
    const response = res();
    await mw(request, response);
    expect(response._status).toBe(201);
    const body = JSON.parse(response._body!);
    expect(body.sessionId).toBeTruthy();
    expect(body.sessionObject).toMatch(/^relay-session-/);
    const s = getSession(body.sessionId);
    expect(s?.hostDevu).toBe("devu/HOST");
    expect(s?.projectSlug).toBe("demo");
  });

  it("POST /api/multiplayer/sessions rejects with 401 if no PAT is configured", async () => {
    getDevRevPatMock.mockResolvedValue(null);
    const mw = multiplayerMiddleware();
    const response = res();
    await mw(req("/api/multiplayer/sessions", "POST", { projectSlug: "demo" }), response);
    expect(response._status).toBe(401);
  });

  it("POST /api/multiplayer/sessions/:id/invite adds a devu to the invite list", async () => {
    const mw = multiplayerMiddleware();
    const create = res();
    await mw(req("/api/multiplayer/sessions", "POST", { projectSlug: "demo" }), create);
    const { sessionId } = JSON.parse(create._body!);

    const invite = res();
    await mw(
      req(
        `/api/multiplayer/sessions/${sessionId}/invite`,
        "POST",
        { devu: "devu/GUEST" },
      ),
      invite,
    );
    expect(invite._status).toBe(200);
    expect(getSession(sessionId)?.invites.map((i) => i.devu)).toContain("devu/GUEST");
  });

  it("GET /api/multiplayer/sessions returns active sessions for this host", async () => {
    const mw = multiplayerMiddleware();
    await mw(req("/api/multiplayer/sessions", "POST", { projectSlug: "a" }), res());
    await mw(req("/api/multiplayer/sessions", "POST", { projectSlug: "b" }), res());
    const list = res();
    await mw(req("/api/multiplayer/sessions", "GET"), list);
    expect(list._status).toBe(200);
    expect(JSON.parse(list._body!).sessions).toHaveLength(2);
  });

  it("POST to /api/multiplayer/sessions/:id/end marks the session ended", async () => {
    const mw = multiplayerMiddleware();
    const create = res();
    await mw(req("/api/multiplayer/sessions", "POST", { projectSlug: "demo" }), create);
    const { sessionId } = JSON.parse(create._body!);

    const end = res();
    await mw(req(`/api/multiplayer/sessions/${sessionId}/end`, "POST"), end);
    expect(end._status).toBe(200);
    expect(listSessions()).toHaveLength(0);
  });

  it("rejects invite from non-host with 403", async () => {
    const mw = multiplayerMiddleware();
    const create = res();
    await mw(req("/api/multiplayer/sessions", "POST", { projectSlug: "demo" }), create);
    const { sessionId } = JSON.parse(create._body!);

    // Swap to guest PAT — the keychain now hands out a different PAT,
    // which resolves to a different devu via the relay/auth mock.
    getDevRevPatMock.mockResolvedValue("guest-pat");

    const invite = res();
    await mw(
      req(
        `/api/multiplayer/sessions/${sessionId}/invite`,
        "POST",
        { devu: "devu/TARGET" },
      ),
      invite,
    );
    expect(invite._status).toBe(403);
  });

  it("passes to next() for unrelated URLs", async () => {
    const mw = multiplayerMiddleware();
    const next = vi.fn();
    await mw(req("/api/frames/list", "GET"), res(), next);
    expect(next).toHaveBeenCalled();
  });
});
