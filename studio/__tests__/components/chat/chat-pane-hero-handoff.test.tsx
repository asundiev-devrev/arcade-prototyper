// @vitest-environment jsdom
//
// Regression for 0.23.x: when the user submits from HomePage we redirect
// to the project route. Until ProjectDetail's effect fires `send()`, the
// chat-stream state is `{ phase: "idle", history: [] }`. Pre-fix, ChatPane
// rendered a static "Try starting with…" suggestion list in that window,
// giving the impression that nothing was happening. The fix is to peek
// the per-slug pending-prompt bucket on first render and paint the user's
// prompt + the live "Working…" indicator immediately.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { setPendingPrompt, __resetPendingPromptForTests } from "../../../src/lib/pendingPrompt";

vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement(tag, { ...props, ref }),
    );
  const ChatBubble: any = ({ children }: any) =>
    React.createElement("div", { "data-testid": "chat-bubble" }, children);
  return {
    IconButton: passthrough("button"),
    Tooltip: ({ children }: any) => React.createElement("div", null, children),
    ChatBubble,
    useToast: () => ({ toast: () => {} }),
  };
});

vi.mock("../../../src/components/chat/PromptInput", () => ({
  PromptInput: ({ busy }: { busy?: boolean }) => (
    <div data-testid="prompt-input" data-busy={busy ? "1" : "0"} />
  ),
}));

vi.mock("../../../src/hooks/chatStreamContext", () => ({
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
    cancel: () => {},
  }),
}));

import { ChatPane } from "../../../src/components/chat/ChatPane";
import { EditBlocksProvider } from "../../../src/hooks/editBlocksContext";

// ChatPane reads the edit-block stream from EditBlocksProvider (always present
// in the real shell via ProjectDetail). Wrap so the hook resolves.
function renderPane(slug: string) {
  return render(
    <EditBlocksProvider>
      <ChatPane projectSlug={slug} history={[]} />
    </EditBlocksProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  __resetPendingPromptForTests();
});

describe("ChatPane hero handoff", () => {
  it("renders the user's pending prompt and a Working… indicator on first paint", () => {
    setPendingPrompt("p-new", {
      prompt: "Build me a settings page",
      imagePaths: [],
      figmaUrl: null,
    });

    renderPane("p-new");

    expect(screen.getByText("Build me a settings page")).toBeTruthy();
    expect(screen.getByText(/Working…/i)).toBeTruthy();
    expect(screen.queryByText(/Try starting with/i)).toBeNull();
  });

  it("does not paint the optimistic Working… row when no pending prompt exists", () => {
    renderPane("p-empty");

    expect(screen.queryByText(/Working…/i)).toBeNull();
    expect(screen.queryByText(/Try starting with/i)).toBeNull();
  });

  it("disables the composer (busy) while the optimistic Working… row is shown", () => {
    setPendingPrompt("p-busy", {
      prompt: "hi",
      imagePaths: [],
      figmaUrl: null,
    });

    renderPane("p-busy");

    expect(screen.getByTestId("prompt-input").getAttribute("data-busy")).toBe("1");
  });
});
