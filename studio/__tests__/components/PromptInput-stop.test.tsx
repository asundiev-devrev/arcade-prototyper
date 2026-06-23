// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("@xorkavi/arcade-gen", async () => {
  const passthrough = (tag: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement(tag, { ...props, ref }),
    );
  return {
    IconButton: passthrough("button"),
    Button: passthrough("button"),
    Tooltip: ({ children }: any) => React.createElement("div", null, children),
    useToast: () => ({ toast: () => {} }),
  };
});

// Stub the ChatInput composite so we don't pull gridstack and the rest of
// the prototype-kit render tree. The real composite renders the trailing
// slot verbatim, so a passthrough preserves the contract this test
// exercises (Send vs Stop button rendering inside `trailing`).
vi.mock("../../prototype-kit/composites/ChatInput", () => {
  const Root = ({ trailing, attachments, placeholder, value }: any) =>
    React.createElement(
      "div",
      { "data-testid": "chat-input", "data-placeholder": placeholder, "data-value": value ?? "" },
      attachments,
      trailing,
    );
  const SendButton = (props: { onClick?: () => void; disabled?: boolean }) =>
    React.createElement(
      "button",
      { type: "button", "aria-label": "Send", onClick: props.onClick, disabled: props.disabled },
      "Send",
    );
  const StopButton = (props: { onClick?: () => void }) =>
    React.createElement(
      "button",
      { type: "button", "aria-label": "Stop", onClick: props.onClick },
      "Stop",
    );
  const AddAttachmentButton = (props: { onClick?: () => void }) =>
    React.createElement("button", { type: "button", "aria-label": "Add", onClick: props.onClick });
  const ContextAttachment = () => React.createElement("div");
  const FileAttachment = () => React.createElement("div");
  return {
    ChatInput: Object.assign(Root, {
      SendButton,
      StopButton,
      AddAttachmentButton,
      ContextAttachment,
      FileAttachment,
    }),
  };
});

import { PromptInput } from "../../src/components/chat/PromptInput";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ users: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness(props: Partial<React.ComponentProps<typeof PromptInput>>) {
  return (
    <PromptInput
      busy={false}
      projectSlug="alpha"
      onSend={() => {}}
      {...props}
    />
  );
}

describe("PromptInput Stop button", () => {
  it("renders the Send button when not busy", () => {
    render(<Harness busy={false} />);
    expect(screen.getByLabelText("Send")).toBeTruthy();
    expect(screen.queryByLabelText("Stop")).toBeNull();
  });

  it("renders the Stop button when busy and onStop is set", () => {
    const onStop = vi.fn();
    render(<Harness busy={true} onStop={onStop} />);
    const stop = screen.getByLabelText("Stop");
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("does not render Stop when onStop is missing (e.g. spectator/comment)", () => {
    render(<Harness busy={true} />);
    expect(screen.queryByLabelText("Stop")).toBeNull();
  });
});
