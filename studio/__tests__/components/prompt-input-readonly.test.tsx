// @vitest-environment jsdom
//
// Spectator-mode ChatPane reuses the same `PromptInput` chrome as authors
// and only flips the submit action via the `commentMode` prop. This test
// captures that contract: when `readonly`, ChatPane must pass a
// `commentMode.onSubmit` to PromptInput; when not readonly, it must not.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

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
// it still renders in spectator mode (live agent thinking remains visible).
vi.mock("../../src/components/chat/MessageList", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));

// Stub PromptInput so the test can observe both: (a) that it's always
// rendered, and (b) what shape `commentMode` arrived in. When commentMode
// is set, the stub renders a textarea + send button keyed by a comment
// placeholder so the integration assertion can drive it like a user would.
vi.mock("../../src/components/chat/PromptInput", () => ({
  PromptInput: ({
    commentMode,
  }: {
    commentMode?: { onSubmit: (text: string) => Promise<void> };
  }) => {
    if (!commentMode) {
      return <div data-testid="prompt-input" data-mode="author" />;
    }
    return (
      <div data-testid="prompt-input" data-mode="comment">
        <textarea
          data-testid="prompt-textarea"
          placeholder="Comment on this prototype…"
          onChange={(e) => {
            (e.target as HTMLTextAreaElement).dataset.value = e.target.value;
          }}
        />
        <button
          data-testid="prompt-send"
          onClick={() => {
            const ta = document.querySelector(
              '[data-testid="prompt-textarea"]',
            ) as HTMLTextAreaElement | null;
            const value = ta?.dataset.value ?? "";
            void commentMode.onSubmit(value);
          }}
        >
          Send
        </button>
      </div>
    );
  },
}));

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
  it("renders PromptInput in commentMode (single composer, same component) when readonly", () => {
    render(
      <ChatPane
        projectSlug="p-1"
        history={[]}
        readonly
        postComment={async () => {}}
      />,
    );

    const promptInputs = screen.getAllByTestId("prompt-input");
    expect(promptInputs.length).toBe(1);
    expect(promptInputs[0].getAttribute("data-mode")).toBe("comment");
    expect(screen.getByPlaceholderText(/comment on this prototype/i)).toBeTruthy();
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
    const sendBtn = screen.getByTestId("prompt-send");
    fireEvent.click(sendBtn);

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

  it("renders PromptInput in author mode (no commentMode prop)", () => {
    render(<ChatPane projectSlug="p-1" history={[]} />);

    const promptInput = screen.getByTestId("prompt-input");
    expect(promptInput.getAttribute("data-mode")).toBe("author");
    expect(screen.queryByPlaceholderText(/comment on this prototype/i)).toBeNull();
  });

});
