import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

// Mock @xorkavi/arcade-gen to avoid gridstack ESM resolution issues pulled in
// via the Dashboard re-export. Provides minimal shims for the components used
// by HeroPromptInput + HeroModelSelector.
vi.mock("@xorkavi/arcade-gen", () => {
  const React = require("react");
  const passthrough = (tag: string) =>
    React.forwardRef<HTMLElement, any>((props: any, ref: any) =>
      React.createElement(tag, { ...props, ref }),
    );
  const Select: any = ({ children }: any) => React.createElement("div", null, children);
  Select.Root = ({ children }: any) => React.createElement("div", null, children);
  Select.Trigger = (props: any) => React.createElement("button", props);
  Select.Content = ({ children }: any) => React.createElement("div", null, children);
  Select.Item = ({ children, ...rest }: any) => React.createElement("div", rest, children);
  return {
    Button: passthrough("button"),
    IconButton: passthrough("button"),
    ArrowUpSmall: () => null,
    PlusSmall: () => null,
    Computer: () => null,
    Select,
  };
});

import { HeroPromptInput } from "../../../src/components/home/HeroPromptInput";

beforeEach(() => {
  // Stub /api/settings so the model selector's initial fetch resolves.
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/settings")) {
      return new Response(JSON.stringify({ studio: { model: "sonnet" } }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as any;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HeroPromptInput", () => {
  it("renders the placeholder text", () => {
    render(<HeroPromptInput onSubmit={vi.fn()} />);
    expect(screen.getByPlaceholderText(/what we're building today/i)).toBeTruthy();
  });

  it("disables the send button when the input is empty", () => {
    render(<HeroPromptInput onSubmit={vi.fn()} />);
    const send = screen.getByRole("button", { name: /send/i });
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables send and calls onSubmit with the prompt when Enter pressed", () => {
    const onSubmit = vi.fn();
    render(<HeroPromptInput onSubmit={onSubmit} />);
    const textarea = screen.getByPlaceholderText(/what we're building today/i);

    fireEvent.change(textarea, { target: { value: "a landing page" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      prompt: "a landing page",
      imagePaths: [],
      figmaUrl: null,
    });
  });

  it("Shift+Enter inserts a newline instead of submitting", () => {
    const onSubmit = vi.fn();
    render(<HeroPromptInput onSubmit={onSubmit} />);
    const textarea = screen.getByPlaceholderText(/what we're building today/i);

    fireEvent.change(textarea, { target: { value: "hi" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shrinks font-size when scrollHeight exceeds the max", () => {
    render(<HeroPromptInput onSubmit={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/what we're building today/i) as HTMLTextAreaElement;

    // jsdom returns 0 for scrollHeight; stub it high enough to force a shrink.
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => 400,
    });

    act(() => {
      fireEvent.change(textarea, { target: { value: "some long prompt" } });
    });

    const size = parseFloat(getComputedStyle(textarea).fontSize);
    expect(size).toBeLessThan(50);
  });
});
