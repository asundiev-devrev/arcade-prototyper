// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import * as overlay from "../../../src/frame/overlay/index";

function stubRect(el: HTMLElement) {
  el.getBoundingClientRect = () => ({ top: 5, left: 5, width: 50, height: 20, bottom: 25, right: 55, x: 5, y: 5, toJSON() {} }) as DOMRect;
}
beforeEach(() => {
  document.documentElement.querySelectorAll("[id^='dm-']").forEach((n) => n.remove());
  overlay.setEnabled(true);
});

describe("overlay facade", () => {
  it("showHover then showSelection paint the respective nodes", () => {
    const el = document.createElement("button"); el.textContent = "X"; stubRect(el); document.body.appendChild(el);
    overlay.showHover(el);
    expect(document.getElementById("dm-hover")!.style.display).toBe("block");
    overlay.showSelection(el);
    expect(document.getElementById("dm-select")!.style.display).toBe("block");
  });

  it("isOverlayElement guards the overlay's own nodes", () => {
    const el = document.createElement("div"); stubRect(el); document.body.appendChild(el);
    overlay.showHover(el);
    expect(overlay.isOverlayElement(document.getElementById("dm-hover") as HTMLElement)).toBe(true);
    expect(overlay.isOverlayElement(el)).toBe(false);
  });

  it("clear hides hover + selection; setEnabled(false) tears down nodes", () => {
    const el = document.createElement("div"); stubRect(el); document.body.appendChild(el);
    overlay.showHover(el); overlay.showSelection(el);
    overlay.clear();
    expect(document.getElementById("dm-hover")!.style.display).toBe("none");
    overlay.setEnabled(false);
    expect(document.getElementById("dm-hover")).toBeNull();
  });

  it("showHover with a selected element renders distance pills", () => {
    const el1 = document.createElement("div"); stubRect(el1); document.body.appendChild(el1);
    const el2 = document.createElement("button"); el2.getBoundingClientRect = () => ({ top: 30, left: 10, width: 40, height: 15, bottom: 45, right: 50, x: 10, y: 30, toJSON() {} }) as DOMRect; document.body.appendChild(el2);
    overlay.showSelection(el1);
    overlay.showHover(el2);
    const distanceLayer = document.getElementById("dm-distance");
    expect(distanceLayer).not.toBeNull();
    expect(distanceLayer!.children.length).toBeGreaterThan(0);
    // Assert at least one pill has numeric distance label
    const pillWithDigit = Array.from(distanceLayer!.children).some(node => /\d/.test((node as HTMLElement).textContent || ""));
    expect(pillWithDigit).toBe(true);
  });
});
