import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installWebviewPasteBridge } from "../../src/lib/webviewPasteBridge";

/**
 * The bridge inserts clipboard text (posted by the extension) at the caret of
 * the focused input and fires a React-visible 'input' event. See
 * webviewPasteBridge.ts for why this exists (VS Code swallows Cmd+V before the
 * cross-origin iframe sees it).
 */
describe("installWebviewPasteBridge", () => {
  let uninstall: () => void;
  let input: HTMLTextAreaElement;

  beforeEach(() => {
    uninstall = installWebviewPasteBridge();
    input = document.createElement("textarea");
    document.body.appendChild(input);
    input.focus();
  });

  afterEach(() => {
    uninstall();
    input.remove();
  });

  function postPaste(text: string) {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "arcade:paste", text } }));
  }

  it("inserts pasted text at the caret of the focused field", () => {
    input.value = "abEF";
    input.setSelectionRange(2, 2);
    postPaste("cd");
    expect(input.value).toBe("abcdEF");
    expect(input.selectionStart).toBe(4);
  });

  it("replaces the current selection", () => {
    input.value = "abXYef";
    input.setSelectionRange(2, 4); // select "XY"
    postPaste("cd");
    expect(input.value).toBe("abcdef");
  });

  it("fires a bubbling input event so React onChange runs", () => {
    const onInput = vi.fn();
    input.addEventListener("input", onInput);
    input.value = "";
    input.setSelectionRange(0, 0);
    postPaste("https://figma.com/x");
    expect(onInput).toHaveBeenCalledOnce();
    expect((onInput.mock.calls[0][0] as Event).bubbles).toBe(true);
  });

  it("ignores messages when no input is focused", () => {
    input.blur();
    (document.activeElement as HTMLElement | null)?.blur();
    const before = input.value;
    postPaste("nope");
    expect(input.value).toBe(before);
  });

  it("ignores unrelated messages", () => {
    input.value = "keep";
    input.setSelectionRange(4, 4);
    window.dispatchEvent(new MessageEvent("message", { data: { type: "something-else", text: "x" } }));
    expect(input.value).toBe("keep");
  });
});
