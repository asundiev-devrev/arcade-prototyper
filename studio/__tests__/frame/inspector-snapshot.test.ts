// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readStyleSnapshot, capture } from "../../src/frame/inspector";

describe("readStyleSnapshot", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("reads text content and the documented style fields", () => {
    const el = document.createElement("button");
    el.textContent = "Save";
    el.style.fontSize = "18px";
    el.style.paddingLeft = "12px";
    document.body.appendChild(el);

    const snap = readStyleSnapshot(el);
    expect(snap.text).toBe("Save");
    expect(snap.fontSize).toBe("18px");
    expect(snap.paddingLeft).toBe("12px");
    // every documented field must be present (string, never undefined)
    for (const key of [
      "text","fontSize","fontWeight","fontStyle","textAlign","color",
      "backgroundColor","borderColor","paddingTop","paddingRight","paddingBottom",
      "paddingLeft","marginTop","marginRight","marginBottom","marginLeft","gap","width","height",
    ]) {
      expect(typeof (snap as Record<string, unknown>)[key]).toBe("string");
    }
  });

  it("uses only the element's own direct text, not descendant text", () => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `Hello <span>world</span>`;
    document.body.appendChild(wrap);
    // direct text node is "Hello " — descendant <span> text excluded
    expect(readStyleSnapshot(wrap).text).toBe("Hello");
  });

  it("auto-resets the previous element when capturing a new one", () => {
    const elA = document.createElement("button") as HTMLButtonElement;
    elA.textContent = "A";
    elA.style.fontSize = "14px";
    const elB = document.createElement("button") as HTMLButtonElement;
    elB.textContent = "B";
    document.body.appendChild(elA);
    document.body.appendChild(elB);

    // Capture A, modify its inline style to simulate a preview.
    capture(elA);
    elA.style.fontSize = "20px";
    elA.textContent = "Modified";

    // Capture B; should auto-reset A's inline style + text to its original.
    capture(elB);
    expect(elA.style.fontSize).toBe("");
    expect(elA.textContent).toBe("A");
  });
});
