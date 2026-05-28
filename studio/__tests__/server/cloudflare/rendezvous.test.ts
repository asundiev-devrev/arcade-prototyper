import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  publishRendezvous,
  fetchRendezvous,
  RendezvousNotFoundError,
} from "../../../server/cloudflare/rendezvous";

const SHARE_ID = "2994f253-a34e-4d5c-858e-1655ff98b0be";
const RELAY = "wss://x.trycloudflare.com/api/multiplayer/ws";
const HOST_DEVU = "don:identity:dvrv-us-1:devo/0:devu/2676";
const KEY = "abc123";
const URL = "https://worker.example.com";

describe("publishRendezvous", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs to /rendezvous/:shareId with Bearer key", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    await publishRendezvous({
      workerUrl: URL,
      shareKey: KEY,
      shareId: SHARE_ID,
      relayUrl: RELAY,
      hostDevu: HOST_DEVU,
      hostDisplayName: "Gil",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      `${URL}/rendezvous/${SHARE_ID}`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: `Bearer ${KEY}` }),
      }),
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      relayUrl: RELAY,
      hostDevu: HOST_DEVU,
      hostDisplayName: "Gil",
    });
  });

  it("throws on non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "bad_relay_url", message: "no" } }),
        { status: 400 },
      ),
    );
    await expect(
      publishRendezvous({
        workerUrl: URL,
        shareKey: KEY,
        shareId: SHARE_ID,
        relayUrl: RELAY,
        hostDevu: HOST_DEVU,
        hostDisplayName: "Gil",
      }),
    ).rejects.toThrow(/bad_relay_url|no/);
  });

  it("propagates network errors", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ENETDOWN"));
    await expect(
      publishRendezvous({
        workerUrl: URL,
        shareKey: KEY,
        shareId: SHARE_ID,
        relayUrl: RELAY,
        hostDevu: HOST_DEVU,
        hostDisplayName: "Gil",
      }),
    ).rejects.toThrow("ENETDOWN");
  });
});

describe("fetchRendezvous", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns the parsed body on 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          shareId: SHARE_ID,
          relayUrl: RELAY,
          hostDevu: HOST_DEVU,
          hostDisplayName: "Gil",
          publishedAt: 123,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const got = await fetchRendezvous({
      workerUrl: URL,
      shareKey: KEY,
      shareId: SHARE_ID,
    });
    expect(got.relayUrl).toBe(RELAY);
    expect(got.hostDisplayName).toBe("Gil");
  });

  it("throws RendezvousNotFoundError on 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 404 }),
    );
    await expect(
      fetchRendezvous({ workerUrl: URL, shareKey: KEY, shareId: SHARE_ID }),
    ).rejects.toBeInstanceOf(RendezvousNotFoundError);
  });

  it("throws on 401 / 5xx with message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "invalid_key", message: "Share key is not recognized" },
        }),
        { status: 401 },
      ),
    );
    await expect(
      fetchRendezvous({ workerUrl: URL, shareKey: KEY, shareId: SHARE_ID }),
    ).rejects.toThrow(/invalid_key|Share key/);
  });
});
