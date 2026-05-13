import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const getDevRevPatMock = vi.fn<() => Promise<string | null>>();
const resolveDevuMock = vi.fn();
const createOrFetchDmMock = vi.fn();
const postToDmMock = vi.fn();
const startTunnelMock = vi.fn();

vi.mock("../../../server/secrets/keychain", () => ({
  getDevRevPat: () => getDevRevPatMock(),
}));
vi.mock("../../../server/relay/auth", () => ({
  resolveDevuFromPat: resolveDevuMock,
}));
vi.mock("../../../server/devrev/dm", () => ({
  createOrFetchDm: createOrFetchDmMock,
  postToDm: postToDmMock,
}));
vi.mock("../../../server/relay/tunnel", () => ({
  startTunnel: startTunnelMock,
  currentTunnelUrl: () => null,
  stopTunnel: vi.fn(),
}));

const { multiplayerInviteMiddleware, __resetMultiplayerInviteForTests } = await import(
  "../../../server/middleware/multiplayerInvite"
);
const { __resetSessionRegistryForTests } = await import(
  "../../../server/relay/sessionRegistry"
);

function req(url: string, method: string, body?: any, headers: Record<string, string> = {}): IncomingMessage {
  const payload = body ? JSON.stringify(body) : "";
  return {
    url, method, headers,
    [Symbol.asyncIterator]: async function* () { if (payload) yield payload; },
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

beforeEach(() => {
  getDevRevPatMock.mockReset();
  resolveDevuMock.mockReset();
  createOrFetchDmMock.mockReset();
  postToDmMock.mockReset();
  startTunnelMock.mockReset();
  __resetSessionRegistryForTests();
  __resetMultiplayerInviteForTests();
  getDevRevPatMock.mockResolvedValue("host-pat");
  resolveDevuMock.mockResolvedValue({
    id: "don:identity:dvrv-us-1:devo/0:devu/HOST",
    displayName: "Host",
  });
  startTunnelMock.mockResolvedValue("https://brave-squirrel-42.trycloudflare.com");
  createOrFetchDmMock.mockResolvedValue("don:core:dvrv-us-1:devo/0:dm/ABC");
  postToDmMock.mockResolvedValue(undefined);
});
afterEach(() => __resetSessionRegistryForTests());

describe("multiplayerInviteMiddleware", () => {
  it("POST /api/multiplayer/invite creates session, tunnel, DM and returns the link", async () => {
    const mw = multiplayerInviteMiddleware();
    const response = res();
    await mw(
      req("/api/multiplayer/invite", "POST", {
        projectSlug: "demo",
        guestDevu: "don:identity:dvrv-us-1:devo/0:devu/GUEST",
        guestDisplayName: "Konstantin",
        promptPreview: "add a sidebar",
      }),
      response,
    );
    expect(response._status).toBe(201);
    const body = JSON.parse(response._body!);
    expect(body.sessionId).toBeTruthy();
    expect(body.inviteUrl).toMatch(/^arcade-studio:\/\/session\//);
    expect(body.inviteUrl).toContain("relay=https%3A%2F%2Fbrave-squirrel-42.trycloudflare.com");
    expect(createOrFetchDmMock).toHaveBeenCalledWith(
      "host-pat",
      "don:identity:dvrv-us-1:devo/0:devu/HOST",
      "don:identity:dvrv-us-1:devo/0:devu/GUEST",
    );
    const postedBody = postToDmMock.mock.calls[0][2];
    expect(postedBody).toContain("invited you");
    expect(postedBody).toContain("arcade-studio://session/");
    expect(postedBody).toContain("add a sidebar");
  });

  it("returns 401 when no PAT is configured", async () => {
    getDevRevPatMock.mockResolvedValue(null);
    const response = res();
    await multiplayerInviteMiddleware()(
      req("/api/multiplayer/invite", "POST", {
        projectSlug: "demo",
        guestDevu: "don:identity:dvrv-us-1:devo/0:devu/GUEST",
        guestDisplayName: "Konstantin",
      }),
      response,
    );
    expect(response._status).toBe(401);
  });

  it("returns 502 with the DM error when posting to DM fails", async () => {
    postToDmMock.mockRejectedValue(new Error("Failed to post to DM: 400 bad body"));
    const response = res();
    await multiplayerInviteMiddleware()(
      req("/api/multiplayer/invite", "POST", {
        projectSlug: "demo",
        guestDevu: "don:identity:dvrv-us-1:devo/0:devu/GUEST",
        guestDisplayName: "K",
      }),
      response,
    );
    expect(response._status).toBe(502);
    expect(JSON.parse(response._body!).error).toMatch(/Failed to post to DM/);
  });

  it("reuses an existing tunnel instead of starting a second one", async () => {
    const mw = multiplayerInviteMiddleware();
    await mw(
      req("/api/multiplayer/invite", "POST", {
        projectSlug: "demo",
        guestDevu: "don:identity:dvrv-us-1:devo/0:devu/A",
        guestDisplayName: "A",
      }),
      res(),
    );
    await mw(
      req("/api/multiplayer/invite", "POST", {
        projectSlug: "demo2",
        guestDevu: "don:identity:dvrv-us-1:devo/0:devu/B",
        guestDisplayName: "B",
      }),
      res(),
    );
    expect(startTunnelMock).toHaveBeenCalledTimes(1);
  });

  it("calls next() for unrelated URLs", async () => {
    const next = vi.fn();
    await multiplayerInviteMiddleware()(req("/api/chat", "POST"), res(), next);
    expect(next).toHaveBeenCalled();
  });
});
