// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act, cleanup } from "@testing-library/react";
import type { Project, ChatMessage } from "../../server/types";
import { useProjectFromHost } from "../../src/hooks/useProjectFromHost";

const sampleProject: Project = {
  name: "Demo",
  slug: "demo",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  theme: "arcade",
  mode: "light",
  frames: [],
};

const sampleHistory: ChatMessage[] = [
  {
    id: "msg-1",
    role: "user",
    content: "hello",
    createdAt: "2026-01-01T00:00:01.000Z",
  },
];

interface CapturedSource {
  project: Project | null;
  chatHistory: ChatMessage[];
  status: "online" | "offline" | "unknown";
  hasSend: boolean;
  hasPostComment: boolean;
  phase: string;
  hostPresenceLength: number;
  guestsLength: number;
}

function HookProbe({
  slug,
  onState,
}: {
  slug: string;
  onState: (s: CapturedSource) => void;
}) {
  const source = useProjectFromHost(slug);
  onState({
    project: source.project,
    chatHistory: source.chatHistory,
    status: source.status,
    hasSend: typeof source.send === "function",
    hasPostComment: typeof source.postComment === "function",
    phase: source.chat.phase,
    hostPresenceLength: source.presence.host ? 1 : 0,
    guestsLength: source.presence.guests.length,
  });
  return null;
}

function installFetchStub() {
  const handler = vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/projects/demo") {
      return Promise.resolve({
        ok: true,
        json: async () => sampleProject,
      });
    }
    if (url === "/api/projects/demo/history") {
      return Promise.resolve({
        ok: true,
        json: async () => sampleHistory,
      });
    }
    if (url.startsWith("/api/chat/stream/")) {
      // Park the SSE stream — never resolve. The hook will wait for chunks.
      return new Promise(() => {});
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
  global.fetch = handler as any;
  return handler;
}

beforeEach(() => {
  installFetchStub();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useProjectFromHost", () => {
  it("fetches project + chat history and exposes the shared source shape", async () => {
    let last: CapturedSource | null = null;
    render(
      <HookProbe
        slug="demo"
        onState={(s) => {
          last = s;
        }}
      />,
    );

    await waitFor(() => {
      expect(last?.project).toBeTruthy();
    });

    expect(last!.project!.slug).toBe("demo");
    expect(last!.chatHistory).toHaveLength(1);
    expect(last!.chatHistory[0]!.id).toBe("msg-1");
    expect(last!.status).toBe("online");
    expect(last!.hasSend).toBe(true);
    expect(last!.hasPostComment).toBe(false);
    expect(last!.phase).toBe("idle");
    expect(last!.hostPresenceLength).toBe(0);
    expect(last!.guestsLength).toBe(0);
  });

  it("calls /api/projects/:slug at least once on mount", async () => {
    const fetchSpy = installFetchStub();
    render(
      <HookProbe
        slug="demo"
        onState={() => {
          // no-op; just observing fetch calls
        }}
      />,
    );

    await waitFor(() => {
      const projectCall = fetchSpy.mock.calls.find(
        ([url]) => url === "/api/projects/demo",
      );
      expect(projectCall).toBeTruthy();
    });
  });

  // Avoid leaking the unresolved chat-stream fetch promise into other tests.
  // We let act() flush microtasks but never expect the stream to settle.
  it("exposes a refresh fn that re-reads the project", async () => {
    let last: CapturedSource | null = null;
    let refresh: (() => void) | null = null;

    function RefreshProbe({ slug }: { slug: string }) {
      const source = useProjectFromHost(slug);
      refresh = source.refresh;
      last = {
        project: source.project,
        chatHistory: source.chatHistory,
        status: source.status,
        hasSend: typeof source.send === "function",
        hasPostComment: typeof source.postComment === "function",
        phase: source.chat.phase,
        hostPresenceLength: source.presence.host ? 1 : 0,
        guestsLength: source.presence.guests.length,
      };
      return null;
    }

    render(<RefreshProbe slug="demo" />);

    await waitFor(() => {
      expect(last?.project).toBeTruthy();
    });

    expect(typeof refresh).toBe("function");
    await act(async () => {
      refresh!();
    });
  });
});
