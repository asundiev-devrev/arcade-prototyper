import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChatStream } from "../../src/hooks/useChatStream";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useChatStream.cancel", () => {
  it("POSTs /api/chat/cancel/:slug when cancel() is called", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/chat/stream/")) {
        return new Response("event: idle\ndata: {\"kind\":\"idle\"}\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      if (typeof url === "string" && url.includes("/api/chat/cancel/")) {
        return new Response(JSON.stringify({ cancelled: true, slug: "alpha" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    });

    const { result } = renderHook(() => useChatStream("alpha"));
    await act(async () => {
      await result.current.cancel();
    });

    const cancelCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === "string" && url.includes("/api/chat/cancel/alpha"),
    );
    expect(cancelCall).toBeDefined();
    expect(cancelCall?.[1]?.method).toBe("POST");
  });

  it("swallows fetch failure so cancel() never throws", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/chat/stream/")) {
        return new Response("event: idle\ndata: {\"kind\":\"idle\"}\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      if (typeof url === "string" && url.includes("/api/chat/cancel/")) {
        throw new TypeError("Failed to fetch");
      }
      return new Response("{}", { status: 404 });
    });

    const { result } = renderHook(() => useChatStream("alpha"));
    await expect(
      act(async () => {
        await result.current.cancel();
      }),
    ).resolves.toBeUndefined();
  });
});
