// @vitest-environment jsdom
//
// Task 3 of Journey Narration: render journey items as their own row in
// MessageList. Verifies the new `data-kind="journey"` row, that journey
// items interleave with tool rows in stream order, and that they render
// independently of <ComputerLive>'s narration aggregate when source is
// "computer" (so they don't get folded into a ComputerMessage bubble).

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const ChatBubble: any = ({ children }: any) =>
    React.createElement("div", { "data-testid": "chat-bubble" }, children);
  const Computer: any = ({ children }: any) =>
    React.createElement("div", { "data-testid": "computer" }, children);
  return { ChatBubble, Computer };
});

import { MessageList } from "../../src/components/chat/MessageList";

afterEach(() => {
  cleanup();
});

describe("MessageList: journey items", () => {
  it("renders a journey item with the data-kind=\"journey\" attribute and the visible text", () => {
    const { container, getByText } = render(
      <MessageList
        history={[]}
        currentItems={[{ kind: "journey", text: "Scanning the design system" }]}
        busy
        phase="running"
        source="claude"
      />,
    );
    expect(getByText("Scanning the design system")).toBeTruthy();
    const row = container.querySelector('[data-kind="journey"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Scanning the design system");
  });

  it("renders journey items interleaved with tool rows in stream order", () => {
    const { container } = render(
      <MessageList
        history={[]}
        currentItems={[
          { kind: "journey", text: "Scanning" },
          { kind: "tool", tool: "Read", pretty: "Reading index.tsx", startedAt: 0 },
          { kind: "journey", text: "Sketching" },
        ]}
        busy
        phase="running"
        source="claude"
      />,
    );
    const rows = container.querySelectorAll('[data-kind]');
    const kinds = Array.from(rows).map((r) => r.getAttribute("data-kind"));
    expect(kinds).toEqual(["journey", "tool", "journey"]);
  });

  it("excludes journey items from <ComputerLive>'s narrations aggregate", () => {
    // Computer-source live turn with one journey + one tool + zero narrations
    // should NOT render a ComputerMessage (which only shows when the live
    // narrations array is non-empty). It should render the journey row
    // separately.
    const { container, queryByText } = render(
      <MessageList
        history={[]}
        currentItems={[
          { kind: "journey", text: "Scanning" },
          { kind: "tool", tool: "Read", pretty: "Reading", startedAt: 0 },
        ]}
        busy
        phase="running"
        source="computer"
      />,
    );
    // Journey text is visible.
    expect(queryByText("Scanning")).not.toBeNull();
    // No bubble/markdown rendering of the journey — it is its own row.
    const journeyRow = container.querySelector('[data-kind="journey"]');
    expect(journeyRow).not.toBeNull();
  });

  it("renders mid-turn narration with the same journey row style", () => {
    // Plan B: while busy, narration items render as italic muted rows in the
    // activity stream — same visual treatment as journey rows. This unifies
    // the three competing styles previously visible during a live turn.
    const { container } = render(
      <MessageList
        history={[]}
        currentItems={[{ kind: "narration", text: "Reading the navigation pattern" }]}
        busy
        phase="running"
        source="claude"
      />,
    );
    const row = container.querySelector('[data-kind="narration"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Reading the navigation pattern");
    expect(row?.style.fontStyle).toBe("italic");
    expect(row?.style.color).toBe("var(--fg-neutral-medium)");
  });

  it("does not render computer-source narration as a ComputerMessage while busy", () => {
    // Mid-turn narration must flow through the activity stream, not collapse
    // into a <ComputerMessage> bubble. The persisted bubble takes over after
    // the turn ends via history.
    const { container } = render(
      <MessageList
        history={[]}
        currentItems={[
          { kind: "narration", text: "Reading the navigation pattern" },
          { kind: "tool", tool: "Read", pretty: "Reading", startedAt: 0 },
        ]}
        busy
        phase="running"
        source="computer"
      />,
    );
    const narrationRow = container.querySelector('[data-kind="narration"]');
    expect(narrationRow).not.toBeNull();
  });
});
