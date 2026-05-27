import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import SharedProject from "../../src/routes/SharedProject";

class FakeEventSource {
  url: string;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, handler: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(handler);
  }
  close() {}
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        metadata: {
          id: "p-1",
          hostDisplayName: "Miha Cuden",
          projectSlug: "discover-v1",
          lastSeenAt: new Date().toISOString(),
        },
        frames: {},
        chat: [],
      }),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SharedProject empty-state", () => {
  it("explains why the viewport is empty when no frames have arrived", async () => {
    render(<SharedProject id="p-1" />);
    await waitFor(() => {
      // Header always renders once metadata loads.
      expect(screen.getByText(/discover-v1/)).toBeTruthy();
    });
    // Empty-state explanation should appear (status starts as "unknown",
    // so we expect the connecting-to-host headline rather than a blank
    // viewport).
    expect(screen.getByText(/Connecting to the host/i)).toBeTruthy();
    // Empty comments sidebar prompt should also render.
    expect(screen.getByText(/No comments yet/i)).toBeTruthy();
  });
});
