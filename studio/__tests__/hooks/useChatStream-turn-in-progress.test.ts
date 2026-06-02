import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useChatStream } from "../../src/hooks/useChatStream";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function streamResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("useChatStream.send — turn already running (409)", () => {
  it("reconnects to the live turn instead of erroring when POST /api/chat returns 409", async () => {
    let streamCalls = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/chat/stream/")) {
        streamCalls += 1;
        // First connection: server reports no turn yet (idle). Subsequent
        // connections (after the 409-driven reconnect): a running turn.
        if (streamCalls === 1) {
          return streamResponse('event: idle\ndata: {"kind":"idle"}\n\n');
        }
        return streamResponse(
          'event: turn\ndata: {"kind":"turn","turnId":"t1","prompt":"hi","startedAt":1,"status":"running"}\n\n',
        );
      }
      if (typeof url === "string" && url.endsWith("/api/chat") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            error: { code: "turn_in_progress", message: "A turn is already running for this project." },
            turnId: "t1",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    });

    const { result } = renderHook(() => useChatStream("alpha"));

    await act(async () => {
      await result.current.send("hi");
    });

    // The 409 must NOT leave the hook in an error phase with the
    // "already running" dead-end message.
    await waitFor(() => {
      expect(result.current.state.phase).not.toBe("error");
    });
    expect(result.current.state.error).toBeNull();

    // It must reconnect: a second stream GET fires to latch onto the live turn.
    await waitFor(() => {
      expect(streamCalls).toBeGreaterThanOrEqual(2);
    });
  });

  it("returns ok for a retry of the SAME prompt as the live turn", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/chat/stream/")) {
        return streamResponse('event: idle\ndata: {"kind":"idle"}\n\n');
      }
      if (typeof url === "string" && url.endsWith("/api/chat") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            error: { code: "turn_in_progress", message: "A turn is already running for this project." },
            turnId: "t1",
            prompt: "make it dark",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    });

    const { result } = renderHook(() => useChatStream("alpha"));

    let res: any;
    await act(async () => {
      res = await result.current.send("make it dark");
    });

    // Same prompt as the live turn → genuine retry, latch on.
    expect(res).toEqual({ ok: true });
  });

  it("returns busy (and does NOT drop) for a NEW prompt typed mid-turn", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/chat/stream/")) {
        return streamResponse('event: idle\ndata: {"kind":"idle"}\n\n');
      }
      if (typeof url === "string" && url.endsWith("/api/chat") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            error: { code: "turn_in_progress", message: "A turn is already running for this project." },
            turnId: "t1",
            prompt: "make it dark",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    });

    const { result } = renderHook(() => useChatStream("alpha"));

    let res: any;
    await act(async () => {
      // A DIFFERENT prompt than the live turn ("make it dark") — the server
      // refused it. Must report busy so the composer keeps the text.
      res = await result.current.send("now add a footer");
    });

    expect(res).toEqual({ ok: false, reason: "busy" });
    // Not surfaced as a hard error.
    await waitFor(() => {
      expect(result.current.state.phase).not.toBe("error");
    });
  });

  it("still surfaces a real error for non-409 POST failures", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/chat/stream/")) {
        return streamResponse('event: idle\ndata: {"kind":"idle"}\n\n');
      }
      if (typeof url === "string" && url.endsWith("/api/chat") && init?.method === "POST") {
        return new Response(
          JSON.stringify({ error: { code: "boom", message: "Something exploded." } }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    });

    const { result } = renderHook(() => useChatStream("alpha"));

    await act(async () => {
      await result.current.send("hi");
    });

    await waitFor(() => {
      expect(result.current.state.phase).toBe("error");
    });
    expect(result.current.state.error).toBe("Something exploded.");
  });
});
