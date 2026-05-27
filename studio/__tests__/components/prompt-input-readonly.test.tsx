// @vitest-environment jsdom
//
// Task 6: ChatPane in spectator mode (readonly=true) must replace the
// authoring `PromptInput` with a comment-only input that posts to the
// shared-projects relay. The persisted message list still renders so
// guests see the host's prompts and the live agent thinking.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// Mock arcade-gen — same shim as sibling component tests. ChatPane only
// needs MessageList's children to render; the message list itself is
// stubbed below to keep this test focused on the input branch.
vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement(tag, { ...props, ref }),
    );
  const ChatBubble: any = ({ children }: any) =>
    React.createElement("div", null, children);
  return {
    IconButton: passthrough("button"),
    Tooltip: ({ children }: any) => React.createElement("div", null, children),
    ChatBubble,
    useToast: () => ({ toast: () => {} }),
  };
});

// Stub MessageList — it pulls in markdown + arcade-gen internals we don't
// need to exercise here. Keeping it as a marker also lets us assert that
// it still renders in spectator mode (per Task 6 brief: "spectator should
// not lose live agent thinking").
vi.mock("../../src/components/chat/MessageList", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));

// Stub PromptInput — its presence/absence is the headline assertion.
vi.mock("../../src/components/chat/PromptInput", () => ({
  PromptInput: () => <div data-testid="prompt-input" />,
}));

// Stub EmptyStatePrompts so the empty-history branch doesn't fight us.
vi.mock("../../src/components/chat/EmptyStatePrompts", () => ({
  EmptyStatePrompts: () => <div data-testid="empty-state-prompts" />,
}));

// Stub the chat stream context hook with a phase=idle / no-history value.
vi.mock("../../src/hooks/chatStreamContext", () => ({
  useChatStreamContext: () => ({
    state: {
      phase: "idle",
      items: [],
      lastPrompt: null,
      source: null,
      turnStartedAt: 0,
      turnEndedAt: undefined,
      error: null,
      errorKind: null,
    },
    send: () => {},
    retry: () => {},
  }),
}));

import { ChatPane } from "../../src/components/chat/ChatPane";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChatPane spectator mode (readonly)", () => {
  it("renders only the comment input (not PromptInput) when readonly with a postComment handler", () => {
    render(
      <ChatPane
        projectSlug="p-1"
        history={[]}
        readonly
        postComment={async () => {}}
      />,
    );

    // Spectator-facing comment input is keyed by its placeholder.
    expect(screen.getByPlaceholderText(/comment on this prototype/i)).toBeTruthy();
    // The authoring prompt textarea must not be present.
    expect(screen.queryByTestId("prompt-input")).toBeNull();
  });

  it("posts comments via the supplied postComment handler", async () => {
    const postComment = vi.fn(async () => {});

    render(
      <ChatPane
        projectSlug="p-1"
        history={[
          {
            id: "u1",
            role: "user",
            content: "hello",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ]}
        readonly
        postComment={postComment}
      />,
    );

    const textarea = screen.getByPlaceholderText(/comment on this prototype/i);
    fireEvent.change(textarea, { target: { value: "looks good!" } });
    const sendBtn = screen.getByRole("button", { name: /send/i });
    fireEvent.click(sendBtn);

    // Allow the async submit to flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(postComment).toHaveBeenCalledWith("looks good!");
  });

  it("still renders the persisted MessageList in spectator mode (live updates remain visible)", () => {
    render(
      <ChatPane
        projectSlug="p-1"
        history={[
          {
            id: "u1",
            role: "user",
            content: "hi",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ]}
        readonly
        postComment={async () => {}}
      />,
    );

    expect(screen.getByTestId("message-list")).toBeTruthy();
  });

  it("renders PromptInput (not the comment input) in author mode", () => {
    render(
      <ChatPane projectSlug="p-1" history={[]} />,
    );

    expect(screen.getByTestId("prompt-input")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/comment on this prototype/i)).toBeNull();
  });
});
