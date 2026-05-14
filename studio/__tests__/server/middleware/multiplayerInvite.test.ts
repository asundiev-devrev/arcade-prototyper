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
// Track tunnel state the way the real `relay/tunnel` module does: once a
// tunnel starts, `currentTunnelUrl()` returns its URL until stopTunnel is
// called (or the process dies). The middleware relies on this being the
// single source of truth, so the mock has to reflect that contract.
let __tunnelState: string | null = null;
startTunnelMock.mockImplementation(async () => {
  __tunnelState = "https://brave-squirrel-42.trycloudflare.com";
  return __tunnelState;
});

vi.mock("../../../server/relay/tunnel", () => ({
  startTunnel: (...args: any[]) => startTunnelMock(...args),
  currentTunnelUrl: () => __tunnelState,
  stopTunnel: vi.fn(() => {
    __tunnelState = null;
  }),
}));

const { multiplayerInviteMiddleware } = await import(
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
  __tunnelState = null;
  __resetSessionRegistryForTests();
  getDevRevPatMock.mockResolvedValue("host-pat");
  resolveDevuMock.mockResolvedValue({
    id: "don:identity:dvrv-us-1:devo/0:devu/HOST",
    displayName: "Host",
  });
  // Re-install the stateful implementation after mockReset wipes it.
  startTunnelMock.mockImplementation(async () => {
    __tunnelState = "https://brave-squirrel-42.trycloudflare.com";
    return __tunnelState;
  });
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
    // inviteUrl is the web landing page (Worker /join/<id>), not the raw scheme.
    expect(body.inviteUrl).toMatch(/^https:\/\/arcade-studio-share\..*\.workers\.dev\/join\//);
    expect(body.inviteUrl).toContain("relay=https%3A%2F%2Fbrave-squirrel-42.trycloudflare.com");
    // The raw arcade-studio:// deep link is still returned for future clients.
    expect(body.deepLink).toMatch(/^arcade-studio:\/\/session\//);
    expect(createOrFetchDmMock).toHaveBeenCalledWith(
      "host-pat",
      "don:identity:dvrv-us-1:devo/0:devu/HOST",
      "don:identity:dvrv-us-1:devo/0:devu/GUEST",
    );
    const postedBody = postToDmMock.mock.calls[0][2];
    expect(postedBody).toContain("invited you");
    // DM message now links to the web landing page, not the raw scheme.
    expect(postedBody).toContain("/join/");
    // URL is wrapped in markdown syntax so Computer renders it as a
    // clickable link instead of inert text.
    expect(postedBody).toMatch(/\[Join the session\]\(https:\/\/[^)]+\/join\/[^)]+\)/);
    expect(postedBody).toContain("add a sidebar");
    // Install-version hint is bumped to 0.18.
    expect(postedBody).toContain("0.18");
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
