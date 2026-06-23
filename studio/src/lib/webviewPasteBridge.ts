/**
 * Webview paste bridge (Cursor / VS Code extension only).
 *
 * Inside the extension's webview, the studio shell runs in a cross-origin
 * iframe (http://localhost:PORT). VS Code intercepts Cmd+V before it reaches
 * the iframe, so native paste into our inputs does nothing. The extension reads
 * the system clipboard on Cmd+V and posts {type:'arcade:paste', text} down to
 * this iframe (extension → outer webview → here). We insert the text at the
 * caret of the focused input/textarea and fire a native 'input' event so React's
 * onChange runs (Figma-URL detection, etc.).
 *
 * Outside the webview (normal browser / Electron) this listener simply never
 * receives the message — native paste already works there — so it's inert.
 */
export function installWebviewPasteBridge(): () => void {
  const onMessage = (e: MessageEvent) => {
    const m = e.data as { type?: string; text?: string } | null;
    if (!m || m.type !== "arcade:paste" || typeof m.text !== "string") return;

    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")) return;

    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + m.text + el.value.slice(end);

    // Use the native value setter so React's onChange sees the change (setting
    // .value directly is swallowed by React's synthetic event tracking).
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, next);
    else el.value = next;

    const caret = start + m.text.length;
    el.setSelectionRange(caret, caret);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
