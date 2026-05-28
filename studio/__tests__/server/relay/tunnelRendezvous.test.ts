import { describe, expect, it, vi, beforeEach } from "vitest";

// vi.mock() factories are hoisted above const declarations; use vi.hoisted()
// so the mock fns exist when the factory runs.
const { publishMock, getShareKeyMock, getProjectMock } = vi.hoisted(() => ({
  publishMock: vi.fn(),
  getShareKeyMock: vi.fn(),
  getProjectMock: vi.fn(),
}));

vi.mock("../../../server/cloudflare/rendezvous", () => ({
  publishRendezvous: publishMock,
  fetchRendezvous: vi.fn(),
  RendezvousNotFoundError: class extends Error {},
}));
vi.mock("../../../server/secrets/shareKey", () => ({
  getShareKey: getShareKeyMock,
}));
vi.mock("../../../server/relay/projectRegistry", async () => {
  const actual = await vi.importActual<typeof import("../../../server/relay/projectRegistry")>(
    "../../../server/relay/projectRegistry",
  );
  return {
    ...actual,
    getProject: getProjectMock,
  };
});
// resolveHostDisplayName fans out into auth + keychain; mock both so the
// test never hits the real network or keychain.
vi.mock("../../../server/relay/auth", () => ({
  resolveDevuFromPat: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../../server/secrets/keychain", () => ({
  getDevRevPat: vi.fn().mockResolvedValue(null),
}));

import {
  acquireTunnel,
  __resetTunnelForTests,
  __resetTunnelRefsForTests,
  __setTunnelUrlForTests,
} from "../../../server/relay/tunnel";

const SHARE_ID = "2994f253-a34e-4d5c-858e-1655ff98b0be";
const TUNNEL_URL = "https://x.trycloudflare.com";

// Drains the fire-and-forget chain inside acquireTunnel:
// dynamic imports (3 microtasks deep) -> getShareKey -> getProject -> publishRendezvous.
async function flush() {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("acquireTunnel publishes rendezvous", () => {
  beforeEach(() => {
    __resetTunnelForTests();
    __resetTunnelRefsForTests();
    __setTunnelUrlForTests(TUNNEL_URL); // skip cloudflared spawn in tests
    publishMock.mockReset();
    getShareKeyMock.mockReset();
    getProjectMock.mockReset();
  });

  it("calls publishRendezvous with the wss-rewritten URL", async () => {
    getShareKeyMock.mockResolvedValue("the-key");
    getProjectMock.mockReturnValue({
      id: SHARE_ID,
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      projectSlug: "p",
      createdAt: "now",
      shared_with: [],
    });
    publishMock.mockResolvedValue(undefined);

    await acquireTunnel(SHARE_ID);
    await flush();

    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
      shareId: SHARE_ID,
      relayUrl: "wss://x.trycloudflare.com/api/multiplayer/ws",
      shareKey: "the-key",
    }));
  });

  it("does not publish when getShareKey returns null", async () => {
    getShareKeyMock.mockResolvedValue(null);
    publishMock.mockResolvedValue(undefined);
    await acquireTunnel(SHARE_ID);
    await flush();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("does not publish when holderId is not a known project", async () => {
    getShareKeyMock.mockResolvedValue("k");
    getProjectMock.mockReturnValue(undefined);
    publishMock.mockResolvedValue(undefined);
    await acquireTunnel("legacy-session-id");
    await flush();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("logs but does not throw when publish fails", async () => {
    getShareKeyMock.mockResolvedValue("k");
    getProjectMock.mockReturnValue({
      id: SHARE_ID,
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      projectSlug: "p",
      createdAt: "now",
      shared_with: [],
    });
    publishMock.mockRejectedValue(new Error("net"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(acquireTunnel(SHARE_ID)).resolves.toBe(TUNNEL_URL);
    await flush();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
