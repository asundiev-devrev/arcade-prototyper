// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useChatStream } from "../../src/hooks/useChatStream";

// Regression for 0.23.4: the SSE GET for `/api/chat/stream/:slug` fires on
// mount AND on every reconnect after `send()`. If the server has no turn
// yet the response is a single `event: idle`. Pre-fix, the idle-frame
// handler called
//   safeSetState(s => s.phase === "idle" ? s : { ...s, phase: "idle" })
// which stomps any non-idle phase. After `send()` optimistically flips to
// `running` and then calls `reconnect()`, the next pump iteration picks up
// the still-empty turn registry, the server emits idle, and that idle frame
// downgrades the optimistic running back to idle. Result: the user prompt
// bubble paints (lastPrompt persists) but no Working… row, no Stop button —
// the "nothing's happening" hero-handoff symptom Nuska reported.
//
// This test pins the post-fix behavior: an idle frame must not stomp a
// running phase.

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function idleSseResponse(): Response {
  return new Response("event: idle\ndata: {\"kind\":\"idle\"}\n\n", {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("useChatStream idle-frame race with send()", () => {
  it("does not stomp the optimistic 'running' phase when an SSE idle frame races send()", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/chat/stream/")) {
        return idleSseResponse();
      }
      if (typeof url === "string" && url.startsWith("/api/chat") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 202 });
      }
      return new Response("{}", { status: 404 });
    });

    const { result } = renderHook(() => useChatStream("alpha"));

    // Wait for the first pump to consume idle and park.
    await waitFor(() => expect(result.current.state.phase).toBe("idle"));

    // send() optimistically flips to running, POSTs /api/chat, then calls
    // reconnect() which wakes the pump for another GET. That second GET
    // returns idle again — and that's the race we're guarding against.
    let sendPromise: ReturnType<typeof result.current.send> | undefined;
    await act(async () => {
      sendPromise = result.current.send("hello world");
    });

    expect(result.current.state.phase).toBe("running");
    expect(result.current.state.lastPrompt).toBe("hello world");

    // Drain microtasks so the reconnected pump fully processes the second
    // idle frame.
    await act(async () => {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 0));
      }
    });

    // Critical assertion: the idle frame from the post-send reconnect must
    // NOT have downgraded phase.
    expect(result.current.state.phase).toBe("running");
    expect(result.current.state.busy).toBe(true);
    expect(result.current.state.lastPrompt).toBe("hello world");

    await act(async () => {
      await sendPromise;
    });
  });

  it("first-mount idle frame leaves phase at idle (no spurious running)", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/chat/stream/")) {
        return idleSseResponse();
      }
      return new Response("{}", { status: 404 });
    });

    const { result } = renderHook(() => useChatStream("alpha"));
    await waitFor(() => expect(result.current.state.phase).toBe("idle"));
  });
});
