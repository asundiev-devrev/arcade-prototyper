// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
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
