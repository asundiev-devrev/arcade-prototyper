// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act, cleanup } from "@testing-library/react";
import type { Project } from "../../server/types";
import { useProjectFromMirror } from "../../src/hooks/useProjectFromMirror";

// ── Fake EventSource ──────────────────────────────────────────────────
//
// We capture every constructed instance so tests can drive `relay` and
// `status` events directly. Mirrors the pattern used in
// `shared-project-empty-state.test.tsx`.

interface FakeEventSourceListeners {
  [type: string]: ((e: MessageEvent) => void)[];
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  listeners: FakeEventSourceListeners = {};
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, handler: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(handler);
  }
  removeEventListener(type: string, handler: (e: MessageEvent) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      (h) => h !== handler,
    );
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    const event = new MessageEvent(type, {
      data: typeof data === "string" ? data : JSON.stringify(data),
    });
    for (const h of this.listeners[type] ?? []) h(event);
  }
}

// ── Sample server payloads ────────────────────────────────────────────

const sampleMetadata = {
  id: "p-1",
  hostDevu: "DEVU-1",
  hostDisplayName: "Miha Cuden",
  projectSlug: "discover-v1",
  addedAt: "2026-05-01T00:00:00.000Z",
  lastSeenAt: "2026-05-20T00:00:00.000Z",
};

const sampleShow = {
  metadata: sampleMetadata,
  frames: {
    "frame-01": "<div>frame 01</div>",
    "frame-02": "<div>frame 02</div>",
  },
  chat: [
    {
      type: "prompt_started",
      turnId: "t-1",
      byDevu: "DEVU-1",
      text: "build me a hero",
    },
    {
      type: "comment_posted",
      id: "c-1",
      byDevu: "DEVU-2",
      displayName: "Andrey",
      text: "love it",
      mentions: [],
      ts: 1716240000000,
    },
  ],
};

// ── Probe + state capture ─────────────────────────────────────────────

interface CapturedSource {
  project: Project | null;
  chatHistoryLength: number;
  status: "online" | "offline" | "unknown";
  hasSend: boolean;
  hasPostComment: boolean;
  phase: string;
  hostPresenceLength: number;
  guestsLength: number;
  frameSlugs: string[];
}

function captureFrom(source: ReturnType<typeof useProjectFromMirror>): CapturedSource {
  return {
    project: source.project,
    chatHistoryLength: source.chatHistory.length,
    status: source.status,
    hasSend: typeof source.send === "function",
    hasPostComment: typeof source.postComment === "function",
    phase: source.chat.phase,
    hostPresenceLength: source.presence.host ? 1 : 0,
    guestsLength: source.presence.guests.length,
    frameSlugs: (source.project?.frames ?? []).map((f) => f.slug),
  };
}

function HookProbe({
  id,
  onState,
}: {
  id: string;
  onState: (s: CapturedSource) => void;
}) {
  const source = useProjectFromMirror(id);
  onState(captureFrom(source));
  return null;
}

function installShowFetchStub() {
  const handler = vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/shared-projects/p-1") {
      return Promise.resolve({ ok: true, json: async () => sampleShow });
    }
    if (url === "/api/shared-projects/p-1/comment") {
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, id: "c-stub", queued: false, ts: 1716240000001 }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
  global.fetch = handler as any;
  return handler;
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal(
    "EventSource",
    FakeEventSource as unknown as typeof EventSource,
  );
  installShowFetchStub();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useProjectFromMirror", () => {
  it("reshapes the show endpoint into the shared ProjectShellSource shape", async () => {
    let last: CapturedSource | null = null;
    render(
      <HookProbe
        id="p-1"
        onState={(s) => {
          last = s;
        }}
      />,
    );

    await waitFor(() => {
      expect(last?.project).toBeTruthy();
    });

    // Project synthesized from metadata + frames record.
    expect(last!.project!.slug).toBe("discover-v1");
    expect(last!.project!.theme).toBe("arcade");
    expect(last!.project!.mode).toBe("light");
    expect(last!.frameSlugs.sort()).toEqual(["frame-01", "frame-02"]);

    // Chat history translated from RelayEvent[] → ChatMessage[].
    // prompt_started + comment_posted → 2 user-visible utterances.
    expect(last!.chatHistoryLength).toBe(2);

    // Spectator-side surface: postComment defined, send undefined.
    expect(last!.hasSend).toBe(false);
    expect(last!.hasPostComment).toBe(true);

    // No presence yet (no relay event delivered).
    expect(last!.hostPresenceLength).toBe(0);
    expect(last!.guestsLength).toBe(0);

    // Stream phase starts idle (no agent_event yet).
    expect(last!.phase).toBe("idle");

    // Status starts unknown until SSE delivers a status frame.
    expect(last!.status).toBe("unknown");
  });

  it("subscribes to /api/shared-projects/:id/stream on mount", async () => {
    let last: CapturedSource | null = null;
    render(<HookProbe id="p-1" onState={(s) => { last = s; }} />);
    await waitFor(() => {
      expect(last?.project).toBeTruthy();
    });
    const es = FakeEventSource.instances.find((i) =>
      i.url.endsWith("/api/shared-projects/p-1/stream"),
    );
    expect(es).toBeTruthy();
  });

  it("applies frame_written / frame_deleted / status / presence_state events", async () => {
    let last: CapturedSource | null = null;
    render(<HookProbe id="p-1" onState={(s) => { last = s; }} />);

    await waitFor(() => {
      expect(last?.project).toBeTruthy();
    });

    const es = FakeEventSource.instances.find((i) =>
      i.url.endsWith("/api/shared-projects/p-1/stream"),
    )!;

    // frame_written: new frame appears in project.frames.
    await act(async () => {
      es.emit("relay", {
        type: "frame_written",
        path: "frame-03",
        content: "<div>three</div>",
        turnId: "t-2",
      });
    });
    expect(last!.frameSlugs.sort()).toEqual([
      "frame-01",
      "frame-02",
      "frame-03",
    ]);

    // frame_deleted: removed.
    await act(async () => {
      es.emit("relay", { type: "frame_deleted", path: "frame-01" });
    });
    expect(last!.frameSlugs.sort()).toEqual(["frame-02", "frame-03"]);

    // status: online.
    await act(async () => {
      es.emit("status", { status: "online" });
    });
    expect(last!.status).toBe("online");

    // presence_state: host + 1 guest.
    await act(async () => {
      es.emit("relay", {
        type: "presence_state",
        host: { devu: "DEVU-1", displayName: "Miha Cuden" },
        guests: [{ devu: "DEVU-2", displayName: "Andrey" }],
      });
    });
    expect(last!.hostPresenceLength).toBe(1);
    expect(last!.guestsLength).toBe(1);
  });

  it("translates agent_event into the same StreamState reducer used by useChatStream", async () => {
    let last: CapturedSource | null = null;
    render(<HookProbe id="p-1" onState={(s) => { last = s; }} />);

    await waitFor(() => {
      expect(last?.project).toBeTruthy();
    });

    const es = FakeEventSource.instances.find((i) =>
      i.url.endsWith("/api/shared-projects/p-1/stream"),
    )!;

    // Inner StudioEvent: a narration → reducer should append a narration item.
    await act(async () => {
      es.emit("relay", {
        type: "agent_event",
        turnId: "t-9",
        event: { kind: "narration", text: "Working on the hero…" },
      });
    });

    // The reducer puts the narration into items + narrations. We don't
    // expose narrations directly through the probe but `phase` should
    // remain idle until `end` arrives — confirming events are flowing.
    // Drive an `end` event and assert phase transitions to `done`.
    await act(async () => {
      es.emit("relay", {
        type: "agent_event",
        turnId: "t-9",
        event: { kind: "end", ok: true },
      });
    });
    expect(last!.phase).toBe("done");
  });

  it("appends prompt_started and comment_posted events to chatHistory live", async () => {
    let last: CapturedSource | null = null;
    render(<HookProbe id="p-1" onState={(s) => { last = s; }} />);

    await waitFor(() => {
      expect(last?.project).toBeTruthy();
    });
    expect(last!.chatHistoryLength).toBe(2);

    const es = FakeEventSource.instances.find((i) =>
      i.url.endsWith("/api/shared-projects/p-1/stream"),
    )!;

    await act(async () => {
      es.emit("relay", {
        type: "prompt_started",
        turnId: "t-2",
        byDevu: "DEVU-1",
        text: "make it pop",
      });
    });
    expect(last!.chatHistoryLength).toBe(3);
  });

  it("postComment POSTs to /api/shared-projects/:id/comment", async () => {
    const fetchSpy = installShowFetchStub();

    let postCommentRef: ((text: string) => Promise<void>) | undefined;
    function PostProbe() {
      const source = useProjectFromMirror("p-1");
      postCommentRef = source.postComment;
      return null;
    }
    render(<PostProbe />);

    await waitFor(() => {
      expect(typeof postCommentRef).toBe("function");
    });

    await act(async () => {
      await postCommentRef!("hi");
    });

    const commentCalls = fetchSpy.mock.calls.filter(
      ([url]) => url === "/api/shared-projects/p-1/comment",
    );
    expect(commentCalls.length).toBe(1);
    const init = commentCalls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ text: "hi" });
  });

  it("postComment optimistically appends and dedupes against the relay echo", async () => {
    // Stub returns id=c-42 + ts so the optimistic-append branch fires.
    const handler = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/shared-projects/p-1") {
        return Promise.resolve({ ok: true, json: async () => sampleShow });
      }
      if (url === "/api/shared-projects/p-1/comment") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, id: "c-42", queued: true, ts: 1716240000999 }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
    global.fetch = handler as any;

    let last: CapturedSource | null = null;
    let postCommentRef: ((text: string) => Promise<void>) | undefined;
    function Probe() {
      const source = useProjectFromMirror("p-1");
      postCommentRef = source.postComment;
      last = captureFrom(source);
      return null;
    }
    render(<Probe />);

    await waitFor(() => {
      expect(last?.chatHistoryLength).toBe(2);
    });

    // Optimistic append: chatHistory grows from 2 → 3 immediately.
    await act(async () => {
      await postCommentRef!("hi from guest");
    });
    expect(last!.chatHistoryLength).toBe(3);

    // Relay echoes the same id later — must replace, not duplicate.
    const es = FakeEventSource.instances.find((i) =>
      i.url.endsWith("/api/shared-projects/p-1/stream"),
    )!;
    await act(async () => {
      es.emit("relay", {
        type: "comment_posted",
        id: "c-42",
        byDevu: "DEVU-2",
        displayName: "Andrey",
        text: "hi from guest",
        mentions: [],
        ts: 1716240000999,
      });
    });
    expect(last!.chatHistoryLength).toBe(3);
  });

  it("refresh() re-fetches the show endpoint", async () => {
    const fetchSpy = installShowFetchStub();
    let refreshRef: (() => Promise<void>) | undefined;
    function RefreshProbe() {
      const source = useProjectFromMirror("p-1");
      refreshRef = source.refresh;
      return null;
    }
    render(<RefreshProbe />);

    await waitFor(() => {
      const calls = fetchSpy.mock.calls.filter(
        ([url]) => url === "/api/shared-projects/p-1",
      );
      expect(calls.length).toBe(1);
    });

    await act(async () => {
      await refreshRef!();
    });

    const calls = fetchSpy.mock.calls.filter(
      ([url]) => url === "/api/shared-projects/p-1",
    );
    expect(calls.length).toBe(2);
  });

  // ── Regression tests (P2 follow-up) ───────────────────────────────

  it("refresh() merges live frames on top of the server snapshot (does not stomp in-flight frame_written)", async () => {
    // Park the show fetch so we can deliver a frame_written between
    // fetch start and JSON parse, then resolve the parked fetch.
    let resolveSecondShow: ((d: typeof sampleShow) => void) | null = null;
    let firstCallSeen = false;
    const handler = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/shared-projects/p-1") {
        if (!firstCallSeen) {
          firstCallSeen = true;
          // Initial mount: resolve immediately with sampleShow.
          return Promise.resolve({ ok: true, json: async () => sampleShow });
        }
        // Subsequent (manual) refresh: park.
        return new Promise((resolve) => {
          resolveSecondShow = (d) =>
            resolve({ ok: true, json: async () => d });
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
    global.fetch = handler as any;

    let last: CapturedSource | null = null;
    let refreshRef: (() => Promise<void>) | undefined;
    function Probe() {
      const source = useProjectFromMirror("p-1");
      refreshRef = source.refresh;
      last = captureFrom(source);
      return null;
    }
    render(<Probe />);

    await waitFor(() => {
      expect(last?.frameSlugs.sort()).toEqual(["frame-01", "frame-02"]);
    });

    // Kick off a refresh that will park.
    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = refreshRef!();
    });

    // While the refresh is in-flight, deliver a frame_written.
    const es = FakeEventSource.instances.find((i) =>
      i.url.endsWith("/api/shared-projects/p-1/stream"),
    )!;
    await act(async () => {
      es.emit("relay", {
        type: "frame_written",
        path: "frame-live",
        content: "<div>live</div>",
        turnId: "t-3",
      });
    });
    expect(last!.frameSlugs).toContain("frame-live");

    // Now resolve the parked refresh with the OLD server snapshot
    // (frame-01 + frame-02 only, NO frame-live). Without the merge
    // fix, frame-live would be erased.
    await act(async () => {
      resolveSecondShow!(sampleShow);
      await refreshPromise;
    });

    expect(last!.frameSlugs.sort()).toEqual([
      "frame-01",
      "frame-02",
      "frame-live",
    ]);
  });

  it("cache_replay with empty chatHistoryTail clears chatHistory (no empty-tail guard)", async () => {
    let last: CapturedSource | null = null;
    render(<HookProbe id="p-1" onState={(s) => { last = s; }} />);

    await waitFor(() => {
      expect(last?.chatHistoryLength).toBe(2);
    });

    const es = FakeEventSource.instances.find((i) =>
      i.url.endsWith("/api/shared-projects/p-1/stream"),
    )!;

    // Replay with an explicitly empty tail — represents a host clear.
    await act(async () => {
      es.emit("relay", {
        type: "cache_replay",
        frames: { "frame-01": "<div>frame 01</div>" },
        chatHistoryTail: [],
      });
    });

    expect(last!.chatHistoryLength).toBe(0);
  });

  it("refresh() on a non-2xx response sets project=null and status=offline", async () => {
    // Stub: first call OK, second call 404 (project unshared).
    let firstCallSeen = false;
    const handler = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/shared-projects/p-1") {
        if (!firstCallSeen) {
          firstCallSeen = true;
          return Promise.resolve({ ok: true, json: async () => sampleShow });
        }
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
    global.fetch = handler as any;

    let last: CapturedSource | null = null;
    let refreshRef: (() => Promise<void>) | undefined;
    function Probe() {
      const source = useProjectFromMirror("p-1");
      refreshRef = source.refresh;
      last = captureFrom(source);
      return null;
    }
    render(<Probe />);

    await waitFor(() => {
      expect(last?.project).toBeTruthy();
    });

    await act(async () => {
      await refreshRef!();
    });

    expect(last!.project).toBeNull();
    expect(last!.status).toBe("offline");
  });

  it("synthesized chatStream identity is stable across renders when chat state is unchanged", async () => {
    const seen: unknown[] = [];
    function IdentityProbe() {
      const source = useProjectFromMirror("p-1");
      seen.push(source.chatStream);
      return null;
    }
    const { rerender } = render(<IdentityProbe />);
    await waitFor(() => {
      expect(seen.length).toBeGreaterThan(0);
    });

    // Force several extra renders. chat state unchanged → chatStream
    // identity must NOT flip on every render (would defeat the
    // useMemo and thrash any consumer doing useEffect on it).
    rerender(<IdentityProbe />);
    rerender(<IdentityProbe />);
    rerender(<IdentityProbe />);

    // Find at least two consecutive renders with the same chatStream
    // identity. Without useMemo every entry is a fresh object.
    const lastTwo = seen.slice(-2);
    expect(lastTwo[0]).toBe(lastTwo[1]);
  });

  it("synthesizes frame slugs verbatim from the path (no shaping via deriveProjectName)", async () => {
    // Mirror is allowed to hand us paths with chars that downstream
    // slug regex rejects — we must pass them through untouched and
    // not silently sanitize. Test asserts the slug == the path.
    const showWithDottedPath = {
      ...sampleShow,
      frames: {
        "weird.path_with-chars-01": "<div>x</div>",
      },
      chat: [],
    };
    const handler = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/shared-projects/p-1") {
        return Promise.resolve({ ok: true, json: async () => showWithDottedPath });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
    global.fetch = handler as any;

    let last: CapturedSource | null = null;
    render(<HookProbe id="p-1" onState={(s) => { last = s; }} />);
    await waitFor(() => {
      expect(last?.project).toBeTruthy();
    });

    expect(last!.frameSlugs).toEqual(["weird.path_with-chars-01"]);
  });

  it("ignores stale show responses after id changes", async () => {
    let resolveOldId: ((d: typeof sampleShow) => void) | null = null;
    const newShow = {
      ...sampleShow,
      metadata: { ...sampleMetadata, id: "p-2", projectSlug: "next" },
      frames: { "frame-x": "<div>x</div>" },
      chat: [],
    };

    const handler = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/shared-projects/p-1") {
        return new Promise((resolve) => {
          resolveOldId = (d: typeof sampleShow) =>
            resolve({ ok: true, json: async () => d });
        });
      }
      if (url === "/api/shared-projects/p-2") {
        return Promise.resolve({ ok: true, json: async () => newShow });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
    global.fetch = handler as any;

    const ref: { current: Project | null } = { current: null };
    function Probe({ id }: { id: string }) {
      const source = useProjectFromMirror(id);
      ref.current = source.project;
      return null;
    }

    const { rerender } = render(<Probe id="p-1" />);
    await act(async () => {
      await Promise.resolve();
    });

    rerender(<Probe id="p-2" />);
    await waitFor(() => {
      expect(ref.current?.slug).toBe("next");
    });

    // Now resolve the parked old fetch — must NOT clobber the new project.
    await act(async () => {
      resolveOldId!(sampleShow);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ref.current?.slug).toBe("next");
  });
});
