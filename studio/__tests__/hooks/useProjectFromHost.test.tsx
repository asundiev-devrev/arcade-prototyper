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

  it("fetches /api/projects/:slug/history exactly once per mount (no duplicate effect)", async () => {
    const fetchSpy = installFetchStub();
    render(
      <HookProbe
        slug="demo"
        onState={() => {
          // no-op
        }}
      />,
    );

    await waitFor(() => {
      const historyCalls = fetchSpy.mock.calls.filter(
        ([url]) => url === "/api/projects/demo/history",
      );
      expect(historyCalls.length).toBeGreaterThan(0);
    });

    // Settle pending microtasks so any duplicate effect (the regression we
    // are guarding against) would have fired before we count.
    await act(async () => {
      await Promise.resolve();
    });

    const historyCalls = fetchSpy.mock.calls.filter(
      ([url]) => url === "/api/projects/demo/history",
    );
    expect(historyCalls.length).toBe(1);
  });

  it("fires history fetch once per arcade-studio:refresh-chat-history event", async () => {
    const fetchSpy = installFetchStub();
    render(
      <HookProbe
        slug="demo"
        onState={() => {
          // no-op
        }}
      />,
    );

    await waitFor(() => {
      const historyCalls = fetchSpy.mock.calls.filter(
        ([url]) => url === "/api/projects/demo/history",
      );
      expect(historyCalls.length).toBe(1);
    });

    await act(async () => {
      window.dispatchEvent(new Event("arcade-studio:refresh-chat-history"));
      await Promise.resolve();
    });

    const historyCalls = fetchSpy.mock.calls.filter(
      ([url]) => url === "/api/projects/demo/history",
    );
    // 1 from mount + 1 from the dispatched event = 2. If duplicated, would be 4.
    expect(historyCalls.length).toBe(2);
  });

  // Avoid leaking the unresolved chat-stream fetch promise into other tests.
  // We let act() flush microtasks but never expect the stream to settle.
  it("exposes a refresh fn that re-reads the project", async () => {
    let last: CapturedSource | null = null;
    let refresh: (() => Promise<void>) | null = null;

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
      await refresh!();
    });
  });

  // Regression: theme-toggle flash. `refresh()` must return a Promise that
  // resolves only AFTER the new project record has been committed. Callers
  // (ProjectDetail.toggleProjectMode) await this before clearing the local
  // theme override so the UI never renders the stale pre-PATCH project.
  it("refresh() resolves only after the new project record is committed", async () => {
    // Drive a slow /api/projects/:slug response so we can assert ordering.
    let resolveProjectFetch: ((p: Project) => void) | null = null;
    let projectFetchCount = 0;

    const handler = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/projects/demo") {
        projectFetchCount += 1;
        if (projectFetchCount === 1) {
          // Initial mount fetch — resolve immediately so the hook seeds.
          return Promise.resolve({ ok: true, json: async () => sampleProject });
        }
        // Subsequent refresh — gate on the test.
        return new Promise((resolve) => {
          resolveProjectFetch = (p: Project) =>
            resolve({ ok: true, json: async () => p });
        });
      }
      if (url === "/api/projects/demo/history") {
        return Promise.resolve({ ok: true, json: async () => sampleHistory });
      }
      if (url.startsWith("/api/chat/stream/")) return new Promise(() => {});
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
    global.fetch = handler as any;

    let observedProject: Project | null = null;
    let refresh: (() => Promise<void>) | null = null;

    function Probe({ slug }: { slug: string }) {
      const source = useProjectFromHost(slug);
      refresh = source.refresh;
      observedProject = source.project;
      return null;
    }

    render(<Probe slug="demo" />);
    await waitFor(() => {
      expect(observedProject).toBeTruthy();
    });
    expect(observedProject!.mode).toBe("light");

    // Kick off the refresh; the awaited promise should NOT settle until
    // we resolve the in-flight fetch with the new record.
    let resolvedEarly = false;
    await act(async () => {
      const pending = refresh!().then(() => {
        resolvedEarly = true;
      });
      // Yield microtasks; if refresh wrongly resolved without a network
      // round-trip, this would flip the flag.
      await Promise.resolve();
      await Promise.resolve();
      expect(resolvedEarly).toBe(false);
      // The hook must still expose the OLD project at this point — the
      // override-clearing flash regression is exactly: caller cleared the
      // override before this resolves and saw the old project briefly.
      expect(observedProject!.mode).toBe("light");

      // Now resolve the fetch with the patched record. After awaiting
      // `pending`, the hook must have committed the new project.
      const updated: Project = { ...sampleProject, mode: "dark" };
      resolveProjectFetch!(updated);
      await pending;
    });

    expect(resolvedEarly).toBe(true);
    expect(observedProject!.mode).toBe("dark");
  });

  // Regression: slug-change race. If the slug changes while a refresh is
  // in flight, the stale response must not overwrite the new slug's
  // project record.
  it("refresh() ignores stale responses after slug changes", async () => {
    let resolveOldSlug: ((p: Project) => void) | null = null;
    const newProject: Project = {
      ...sampleProject,
      slug: "next",
      name: "Next",
      mode: "dark",
    };

    const handler = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/projects/demo") {
        // Park indefinitely; the test resolves it after slug switch.
        return new Promise((resolve) => {
          resolveOldSlug = (p: Project) =>
            resolve({ ok: true, json: async () => p });
        });
      }
      if (url === "/api/projects/next") {
        return Promise.resolve({ ok: true, json: async () => newProject });
      }
      if (url.endsWith("/history")) {
        return Promise.resolve({ ok: true, json: async () => sampleHistory });
      }
      if (url.startsWith("/api/chat/stream/")) return new Promise(() => {});
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
    global.fetch = handler as any;

    const ref: { current: Project | null } = { current: null };
    function Probe({ slug }: { slug: string }) {
      const source = useProjectFromHost(slug);
      ref.current = source.project;
      return null;
    }

    const { rerender } = render(<Probe slug="demo" />);

    // Initial fetch is parked; project stays null until we resolve it,
    // but we never will for the old slug — we change slugs first.
    await act(async () => {
      await Promise.resolve();
    });

    // Switch slugs. New fetch resolves immediately with the new project.
    rerender(<Probe slug="next" />);
    await waitFor(() => {
      expect(ref.current?.slug).toBe("next");
    });

    // Now resolve the OLD slug fetch with a stale record. If the gen
    // guard is missing, this would overwrite the new project.
    await act(async () => {
      resolveOldSlug!(sampleProject);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ref.current?.slug).toBe("next");
    expect(ref.current?.mode).toBe("dark");
  });
});
