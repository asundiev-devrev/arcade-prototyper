import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useChatStream } from "../../src/hooks/useChatStream";
import { SCOPED_EDIT_MARKER } from "../../src/lib/scopedEdit";

/**
 * The scoped-edit leak fix, client side. A scoped edit sends the agent the FULL
 * prompt (hidden targeting preamble + the words the user typed) but shows the
 * user only the words. `send(prompt, images, displayPrompt)` must:
 *  - keep `lastPrompt` = the full prompt (retry + the 409 retry-vs-new compare
 *    read it — a scoped edit that loses its preamble on retry edits the wrong
 *    element);
 *  - set `lastDisplayPrompt` = the clean text (the bubble + de-dupe read it);
 *  - POST BOTH so the server persists the clean text but routes on the full one.
 */

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

/** Capture every POST /api/chat body; keep the stream idle so nothing else fires. */
function captureBodies(bodies: any[]) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/api/chat/stream/")) {
      return streamResponse('event: idle\ndata: {"kind":"idle"}\n\n');
    }
    if (typeof url === "string" && url.endsWith("/api/chat") && init?.method === "POST") {
      bodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ turnId: "t1", slug: "alpha" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 404 });
  });
}

const TYPED = "make this button open a filter popover";
const FULL = `${SCOPED_EDIT_MARKER}\n\nTarget element:\n- <Button> at frames/x/index.tsx:42\n\n${TYPED}`;

describe("useChatStream.send — display vs agent prompt split", () => {
  it("keeps lastPrompt full but lastDisplayPrompt clean, and POSTs both", async () => {
    const bodies: any[] = [];
    captureBodies(bodies);

    const { result } = renderHook(() => useChatStream("alpha"));
    await act(async () => {
      await result.current.send(FULL, [], TYPED);
    });

    // Optimistic state: bubble reads clean, agent/retry reads full.
    expect(result.current.state.lastPrompt).toBe(FULL);
    expect(result.current.state.lastDisplayPrompt).toBe(TYPED);

    // The POST carries the full prompt (routing/agent) AND the clean display text.
    expect(bodies).toHaveLength(1);
    expect(bodies[0].prompt).toBe(FULL);
    expect(bodies[0].displayPrompt).toBe(TYPED);
  });

  it("defaults displayPrompt to the prompt when none is given (ordinary turn)", async () => {
    const bodies: any[] = [];
    captureBodies(bodies);

    const { result } = renderHook(() => useChatStream("alpha"));
    await act(async () => {
      await result.current.send("build me a dashboard");
    });

    expect(result.current.state.lastPrompt).toBe("build me a dashboard");
    expect(result.current.state.lastDisplayPrompt).toBe("build me a dashboard");
    expect(bodies[0].displayPrompt).toBe("build me a dashboard");
  });

  it("retry resends the FULL prompt but keeps the clean display text", async () => {
    const bodies: any[] = [];
    // The stream settles the turn (header done + end) carrying the full prompt
    // and clean display text, so the hook leaves "running" and retry can fire
    // while lastPrompt/lastDisplayPrompt still hold the scoped values.
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/chat/stream/")) {
        return streamResponse(
          `event: turn\ndata: ${JSON.stringify({
            kind: "turn", turnId: "t1", prompt: FULL, displayPrompt: TYPED, startedAt: 1, status: "done", endedAt: 2,
          })}\n\n` + 'event: message\ndata: {"kind":"end","ok":true}\n\n',
        );
      }
      if (typeof url === "string" && url.endsWith("/api/chat") && init?.method === "POST") {
        bodies.push(JSON.parse(init.body as string));
        return new Response(JSON.stringify({ turnId: "t1", slug: "alpha" }), {
          status: 202, headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    });

    const { result } = renderHook(() => useChatStream("alpha"));
    // First a scoped send, then let it settle to a non-running phase so retry fires.
    await act(async () => {
      await result.current.send(FULL, [], TYPED);
    });
    await waitFor(() => {
      expect(result.current.state.phase).not.toBe("running");
    });

    await act(async () => {
      result.current.retry();
    });

    // The retry POST must carry the full prompt (preamble intact) with the
    // clean display text — never a preamble-stripped agent prompt.
    const retryBody = bodies[bodies.length - 1];
    expect(retryBody.prompt).toBe(FULL);
    expect(retryBody.displayPrompt).toBe(TYPED);
  });

  it("adopts the server turn header's displayPrompt on reconnect (mid-turn refresh stays clean)", async () => {
    let streamCalls = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/chat/stream/")) {
        streamCalls += 1;
        // A running turn whose header carries a full prompt + a clean displayPrompt.
        return streamResponse(
          `event: turn\ndata: ${JSON.stringify({
            kind: "turn",
            turnId: "t9",
            prompt: FULL,
            displayPrompt: TYPED,
            startedAt: 1,
            status: "running",
          })}\n\n`,
        );
      }
      return new Response("{}", { status: 404 });
    });

    const { result } = renderHook(() => useChatStream("alpha"));
    await waitFor(() => {
      expect(result.current.state.lastPrompt).toBe(FULL);
    });
    expect(result.current.state.lastDisplayPrompt).toBe(TYPED);
    void streamCalls;
  });

  it("falls back to prompt when an older server header omits displayPrompt", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/chat/stream/")) {
        return streamResponse(
          'event: turn\ndata: {"kind":"turn","turnId":"t1","prompt":"legacy prompt","startedAt":1,"status":"running"}\n\n',
        );
      }
      return new Response("{}", { status: 404 });
    });

    const { result } = renderHook(() => useChatStream("alpha"));
    await waitFor(() => {
      expect(result.current.state.lastPrompt).toBe("legacy prompt");
    });
    expect(result.current.state.lastDisplayPrompt).toBe("legacy prompt");
  });
});
