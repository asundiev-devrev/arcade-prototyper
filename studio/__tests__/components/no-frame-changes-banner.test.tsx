// @vitest-environment jsdom
//
// The server appends NO_CHANGES_TRAILER to the assistant message body when an
// agent claims edits that didn't actually happen. The client splits on the
// sentinel and renders a dedicated banner instead of inline prose. Verify:
//   1. splitNoChangesTrailer() correctly partitions content/warning
//   2. MessageList renders the banner separately from the assistant bubble
//      and does NOT include the trailer text inside the bubble

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

import { NO_CHANGES_TRAILER } from "../../server/frameChangeContract";
import { splitNoChangesTrailer } from "../../src/components/chat/NoFrameChangesBanner";
import { MessageList } from "../../src/components/chat/MessageList";

afterEach(() => {
  cleanup();
});

describe("splitNoChangesTrailer", () => {
  it("returns the body unchanged when no trailer is present", () => {
    const { body, hasWarning } = splitNoChangesTrailer("Hello world");
    expect(body).toBe("Hello world");
    expect(hasWarning).toBe(false);
  });

  it("splits the trailer off when it is present at the end of the body", () => {
    const original = "Done!" + NO_CHANGES_TRAILER;
    const { body, hasWarning } = splitNoChangesTrailer(original);
    expect(body).toBe("Done!");
    expect(hasWarning).toBe(true);
  });

  it("trims whitespace before the sentinel so the body doesn't keep dangling newlines", () => {
    const original = "Done!\n\n⚠ Studio detected no frame changes this turn — explanation here.";
    const { body, hasWarning } = splitNoChangesTrailer(original);
    expect(body).toBe("Done!");
    expect(hasWarning).toBe(true);
  });
});

describe("MessageList: no-frame-changes warning banner", () => {
  it("renders the banner separately when an assistant computer message contains the trailer", () => {
    const { container, queryByText, getByRole } = render(
      <MessageList
        history={[
          {
            id: "m1",
            role: "assistant",
            content: "All set." + NO_CHANGES_TRAILER,
            source: "computer",
            createdAt: 0,
          },
        ]}
      />,
    );
    expect(getByRole("status")).toBeTruthy();
    expect(queryByText("No frame changes detected")).toBeTruthy();
    expect(container.textContent).not.toContain("⚠ Studio detected no frame changes this turn");
    expect(container.textContent).toContain("All set.");
  });

  it("renders the banner separately for a non-computer assistant message too", () => {
    const { container, getByRole } = render(
      <MessageList
        history={[
          {
            id: "m2",
            role: "assistant",
            content: "Done." + NO_CHANGES_TRAILER,
            source: "claude",
            createdAt: 0,
          },
        ]}
      />,
    );
    expect(getByRole("status")).toBeTruthy();
    expect(container.textContent).not.toContain("⚠ Studio detected no frame changes this turn");
  });

  it("does not render the banner when the trailer is absent", () => {
    const { queryByRole } = render(
      <MessageList
        history={[
          {
            id: "m3",
            role: "assistant",
            content: "Just a plain reply.",
            source: "computer",
            createdAt: 0,
          },
        ]}
      />,
    );
    expect(queryByRole("status")).toBeNull();
  });
});
