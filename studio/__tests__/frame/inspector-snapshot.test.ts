// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readStyleSnapshot, isTextEditable, capture } from "../../src/frame/inspector";

beforeEach(() => { document.body.innerHTML = ""; });

describe("readStyleSnapshot", () => {
  it("reads own text + documented style fields incl. gap", () => {
    const el = document.createElement("button");
    el.textContent = "Save";
    el.style.fontSize = "18px";
    document.body.appendChild(el);
    const snap = readStyleSnapshot(el);
    expect(snap.text).toBe("Save");
    expect(snap.fontSize).toBe("18px");
    expect(typeof snap.gap).toBe("string");
  });

  it("reads the slice-1 layout/appearance fields", () => {
    const el = document.createElement("div");
    el.style.minWidth = "10px"; el.style.opacity = "0.5"; el.style.display = "flex";
    document.body.appendChild(el);
    const snap = readStyleSnapshot(el);
    expect(snap.minWidth).toBe("10px");
    expect(snap.opacity).toBe("0.5");
    expect(snap.display).toBe("flex");
    expect(typeof snap.flexDirection).toBe("string");
    expect(typeof snap.borderRadius).toBe("string");
  });
});

describe("isTextEditable", () => {
  it("true for a leaf element with own text", () => {
    const el = document.createElement("button"); el.textContent = "Click";
    document.body.appendChild(el);
    expect(isTextEditable(el)).toBe(true);
  });
  it("false for a container with child elements", () => {
    const div = document.createElement("div");
    div.innerHTML = `<span>a</span><span>b</span>`;
    document.body.appendChild(div);
    expect(isTextEditable(div)).toBe(false);
  });
  it("false for an empty leaf", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(isTextEditable(el)).toBe(false);
  });
});

describe("capture + preview", () => {
  it("stamps a numeric editId and reuses it on re-capture", () => {
    const el = document.createElement("button"); el.textContent = "X";
    document.body.appendChild(el);
    const a = capture(el);
    expect(typeof a.editId).toBe("number");
    const b = capture(el);
    expect(b.editId).toBe(a.editId);
    expect(el.getAttribute("data-arcade-edit-id")).toBe(String(a.editId));
  });

  it("REGRESSION: previewing/resetting a CONTAINER never deletes its children", () => {
    const card = document.createElement("div");
    card.innerHTML = `<h2>Title</h2><p>Body</p>`;
    document.body.appendChild(card);
    const { editId } = capture(card); // container: textEditable false
    // simulate a style preview + reset round trip via the message handler
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:preview", editId, field: "backgroundColor", value: "rgb(1,2,3)" },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:preview-reset", editId },
    }));
    // children MUST survive (the v1 bug deleted them via textContent="")
    expect(card.querySelector("h2")).not.toBeNull();
    expect(card.querySelector("p")).not.toBeNull();
    expect(card.style.backgroundColor).toBe("");
  });

  it("REGRESSION: resetting an element with SOURCE inline styles restores them, not blanks them", () => {
    // A Figma-imported element styles itself with an inline `style` prop. The
    // inspector previews + resets must NOT wipe the author's own inline styles.
    const el = document.createElement("div");
    el.style.fontSize = "22px";
    el.style.color = "rgb(76, 71, 72)";
    el.style.display = "flex";
    el.textContent = "Good morning, Polina!";
    document.body.appendChild(el);
    const { editId } = capture(el);
    // preview a font-size change, then reset (the per-row × path)
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:preview", editId, field: "fontSize", value: "40px" },
    }));
    expect(el.style.fontSize).toBe("40px"); // preview applied
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:preview-reset", editId },
    }));
    // reset MUST restore the ORIGINAL inline styles, not blank them
    expect(el.style.fontSize).toBe("22px");
    expect(el.style.color).toBe("rgb(76, 71, 72)");
    expect(el.style.display).toBe("flex");
  });

  it("style preview targets the right element by editId", () => {
    const a = document.createElement("button"); a.textContent = "A"; document.body.appendChild(a);
    const b = document.createElement("button"); b.textContent = "B"; document.body.appendChild(b);
    const ca = capture(a); const cb = capture(b);
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:preview", editId: ca.editId, field: "fontSize", value: "40px" },
    }));
    expect(a.style.fontSize).toBe("40px");
    expect(b.style.fontSize).toBe("");
    expect(cb.editId).not.toBe(ca.editId);
  });
});

describe("contenteditable on interactive elements", () => {
  beforeEach(() => {
    // Mock document.execCommand since jsdom doesn't implement it
    document.execCommand = vi.fn();
  });

  it("allows Space in contenteditable button", () => {
    const button = document.createElement("button");
    button.textContent = "Click";
    document.body.appendChild(button);
    const { editId } = capture(button);

    // Double-click to enter edit mode
    const dblEvent = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    Object.defineProperty(dblEvent, "target", { value: button, writable: false });
    document.dispatchEvent(dblEvent);

    expect(button.getAttribute("contenteditable")).toBe("true");

    // Try to insert a space
    const spaceEvent = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    const prevented = !button.dispatchEvent(spaceEvent);

    expect(prevented).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("insertText", false, " ");
  });

  it("commits edit on Enter in contenteditable button", () => {
    const button = document.createElement("button");
    button.textContent = "Click";
    document.body.appendChild(button);
    capture(button);

    // Enter edit mode
    const dblEvent = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    Object.defineProperty(dblEvent, "target", { value: button, writable: false });
    document.dispatchEvent(dblEvent);

    expect(button.getAttribute("contenteditable")).toBe("true");

    // Press Enter (should commit)
    const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    const prevented = !button.dispatchEvent(enterEvent);

    expect(prevented).toBe(true);
    // blur() should have been called, which removes contenteditable
    // In jsdom, blur is synchronous
    expect(button.getAttribute("contenteditable")).toBeNull();
  });
});

describe("icon detection + preview", () => {
  it("capture reports iconCandidate = the single icon component name (self)", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    function Bell() { return null; }
    (svg as any).__reactFiber$x = { type: Bell };
    document.body.appendChild(svg);
    const cap = capture(svg as unknown as HTMLElement);
    expect(cap.iconCandidate).toBe("Bell");
  });

  it("capture reports iconCandidate = the single icon descendant when the picked node contains one svg", () => {
    const row = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    function Star() { return null; }
    (svg as any).__reactFiber$x = { type: Star };
    row.appendChild(svg);
    document.body.appendChild(row);
    const cap = capture(row);
    expect(cap.iconCandidate).toBe("Star");
  });

  it("capture reports no iconCandidate when zero or multiple svgs present", () => {
    const none = document.createElement("div"); document.body.appendChild(none);
    expect(capture(none).iconCandidate).toBeUndefined();
    const multi = document.createElement("div");
    multi.appendChild(document.createElementNS("http://www.w3.org/2000/svg","svg"));
    multi.appendChild(document.createElementNS("http://www.w3.org/2000/svg","svg"));
    document.body.appendChild(multi);
    expect(capture(multi).iconCandidate).toBeUndefined();
  });

  it("preview-icon swaps the icon node innerHTML; reset restores it", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.innerHTML = "<path d='M1'/>";
    function Bell() { return null; }
    (svg as any).__reactFiber$x = { type: Bell };
    document.body.appendChild(svg);
    const { editId } = capture(svg as unknown as HTMLElement);
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:preview-icon", editId, svg: "<svg><path d='M2'/></svg>" },
    }));
    expect(svg.innerHTML).toContain("M2");
    window.dispatchEvent(new MessageEvent("message", { data: { type: "arcade-studio:preview-reset", editId } }));
    expect(svg.innerHTML).toContain("M1");
  });
});

describe("appliedTokens scan", () => {
  it("reads applied arcade token classes into appliedTokens", () => {
    const el = document.createElement("p");
    el.className = "text-body-medium text-(--fg-neutral-subtle) px-4";
    el.textContent = "Hi";
    document.body.appendChild(el);
    const snap = readStyleSnapshot(el);
    expect(snap.appliedTokens.typeStyle).toBe("text-body-medium");
    expect(snap.appliedTokens.color).toBe("text-(--fg-neutral-subtle)");
    expect(snap.appliedTokens.backgroundColor).toBeUndefined();
  });

  it("appliedTokens empty when element carries no token classes", () => {
    const el = document.createElement("div");
    el.className = "flex items-center";
    document.body.appendChild(el);
    expect(readStyleSnapshot(el).appliedTokens.typeStyle).toBeUndefined();
    expect(readStyleSnapshot(el).appliedTokens.color).toBeUndefined();
  });

  it("preview-class toggles the token class on the captured node", () => {
    const el = document.createElement("p");
    el.className = "text-body";
    el.textContent = "Hi";
    document.body.appendChild(el);
    const { editId } = capture(el);
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:preview-class", editId, slot: "typeStyle", className: "text-title-large", prevClassName: "text-body" },
    }));
    expect(el.classList.contains("text-title-large")).toBe(true);
    expect(el.classList.contains("text-body")).toBe(false);
  });

  it("preview-class for a color slot applies the token's var() inline so the preview is visible even when the Tailwind class was never compiled", () => {
    const el = document.createElement("p");
    el.textContent = "Hi";
    document.body.appendChild(el);
    const { editId } = capture(el);
    // First apply a raw backgroundColor preview (inline style)
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:preview", editId, field: "backgroundColor", value: "#ff0000" },
    }));
    expect(el.style.backgroundColor).toBe("rgb(255, 0, 0)");
    // Now apply a token class preview. The class string is built dynamically by
    // the catalog and is usually NOT a literal in scanned source, so Tailwind
    // never compiled a rule for it — adding the class alone is a no-op. The
    // preview must instead set the inline style to the token's var() chain,
    // which resolves against the frame's token CSS regardless.
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:preview-class", editId, slot: "backgroundColor", className: "bg-(--bg-success-medium)" },
    }));
    expect(el.style.backgroundColor).toBe("var(--bg-success-medium)");
    expect(el.classList.contains("bg-(--bg-success-medium)")).toBe(true);
  });

  it("preview-class restores the token var() for a color slot on reset", () => {
    const el = document.createElement("p");
    el.textContent = "Hi";
    document.body.appendChild(el);
    const { editId } = capture(el);
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "arcade-studio:preview-class", editId, slot: "color", className: "text-(--fg-success-prominent)" },
    }));
    expect(el.style.color).toBe("var(--fg-success-prominent)");
    window.dispatchEvent(new MessageEvent("message", { data: { type: "arcade-studio:preview-reset", editId } }));
    expect(el.style.color).toBe("");
    expect(el.classList.contains("text-(--fg-success-prominent)")).toBe(false);
  });
});
