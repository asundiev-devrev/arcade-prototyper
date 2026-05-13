// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement(tag, { ...props, ref }),
    );
  const Modal = {
    Root: ({ open, children }: any) =>
      open
        ? React.createElement("div", { role: "dialog" }, children)
        : null,
    Content: ({ children }: any) => React.createElement("div", null, children),
    Header: ({ children }: any) => React.createElement("div", null, children),
    Title: ({ children }: any) => React.createElement("h2", null, children),
    Description: ({ children }: any) => React.createElement("p", null, children),
    Body: ({ children }: any) => React.createElement("div", null, children),
    Footer: ({ children }: any) => React.createElement("div", null, children),
  };
  return {
    Button: passthrough("button"),
    Modal,
  };
});

import { JoinSessionGate } from "../../../src/components/multiplayer/JoinSessionGate";

// Minimal WebSocket stub
class FakeWS {
  static instances: FakeWS[] = [];
  url: string;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }
  send = vi.fn();
  close = vi.fn();
  fakeOpen() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  fakeMessage(data: any) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}

function installFetchStub() {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes("devrev-pat/raw")) {
      return Promise.resolve({ ok: true, json: async () => ({ pat: "test-pat" }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  }) as any;
}

beforeEach(() => {
  FakeWS.instances = [];
  (global as any).WebSocket = FakeWS;
  installFetchStub();
});
afterEach(() => {
  cleanup();
  FakeWS.instances = [];
});

describe("JoinSessionGate", () => {
  it("renders the invite card with relay host info", () => {
    render(
      <JoinSessionGate
        sessionId="abc-123"
        relayUrl="https://bar.trycloudflare.com"
        onJoined={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/You've been invited/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Join$/i })).toBeTruthy();
  });

  it("opens a WebSocket to the relay with sessionId and pat query params when Join is clicked", async () => {
    render(
      <JoinSessionGate
        sessionId="abc-123"
        relayUrl="https://bar.trycloudflare.com"
        onJoined={() => {}}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Join$/i }));
    await waitFor(() => expect(FakeWS.instances).toHaveLength(1));
    const wsUrl = FakeWS.instances[0].url;
    expect(wsUrl).toContain("wss://bar.trycloudflare.com/api/multiplayer/ws");
    expect(wsUrl).toContain("sessionId=abc-123");
    expect(wsUrl).toContain("pat=test-pat");
  });

  it("calls onJoined once session_state is received", async () => {
    const onJoined = vi.fn();
    render(
      <JoinSessionGate
        sessionId="abc-123"
        relayUrl="https://bar.trycloudflare.com"
        onJoined={onJoined}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Join$/i }));
    await waitFor(() => expect(FakeWS.instances).toHaveLength(1));
    FakeWS.instances[0].fakeOpen();
    FakeWS.instances[0].fakeMessage({
      type: "session_state",
      driverDevu: "devu/HOST",
      connections: [{ devu: "devu/HOST", displayName: "Host" }],
      sessionObject: "relay-session-abc",
    });
    await waitFor(() => expect(onJoined).toHaveBeenCalledOnce());
  });

  it("shows an error if the WebSocket closes before session_state", async () => {
    render(
      <JoinSessionGate
        sessionId="abc-123"
        relayUrl="https://bar.trycloudflare.com"
        onJoined={() => {}}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Join$/i }));
    await waitFor(() => expect(FakeWS.instances).toHaveLength(1));
    FakeWS.instances[0].onclose?.(new CloseEvent("close", { code: 4401 }));
    await waitFor(() =>
      expect(screen.getByText(/Could not connect/i)).toBeTruthy(),
    );
  });

  it("shows an error when the PAT is missing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pat: null }),
    }) as any;
    render(
      <JoinSessionGate
        sessionId="abc-123"
        relayUrl="https://bar.trycloudflare.com"
        onJoined={() => {}}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Join$/i }));
    await waitFor(() =>
      expect(screen.getByText(/PAT/i)).toBeTruthy(),
    );
    // No WebSocket should have been opened.
    expect(FakeWS.instances).toHaveLength(0);
  });
});
