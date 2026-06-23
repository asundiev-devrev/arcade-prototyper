// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { showHover, showSelect, hideHover, hideSelect, destroyOverlays, resetOverlayTeardown, isOverlayElement } from "../../../src/frame/overlay/overlays";

function stubRect(el: HTMLElement, r: Partial<DOMRect>) {
  el.getBoundingClientRect = () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0, x: 0, y: 0, toJSON() {}, ...r }) as DOMRect;
}

beforeEach(() => {
  document.documentElement.querySelectorAll("[id^='dm-']").forEach((n) => n.remove());
  resetOverlayTeardown();
});

describe("overlays", () => {
  it("showHover paints a positioned, visible hover outline (position:fixed)", () => {
    const el = document.createElement("div");
    stubRect(el, { top: 10, left: 20, width: 100, height: 40, bottom: 50, right: 120 });
    document.body.appendChild(el);
    showHover(el);
    const hover = document.getElementById("dm-hover")!;
    expect(hover).toBeTruthy();
    expect(hover.style.position).toBe("fixed");
    expect(hover.style.display).toBe("block");
    expect(hover.style.top).toBe("10px");
    expect(hover.style.width).toBe("100px");
  });

  it("showSelect sets the W×H dimension label text", () => {
    const el = document.createElement("div");
    stubRect(el, { top: 0, left: 0, width: 128, height: 64, bottom: 64, right: 128 });
    document.body.appendChild(el);
    showSelect(el);
    expect(document.getElementById("dm-dim-label")!.textContent).toBe("128 × 64");
  });

  it("paints margin + padding bands when the element has spacing", () => {
    const el = document.createElement("div");
    el.style.marginTop = "8px"; el.style.paddingLeft = "12px";
    stubRect(el, { top: 0, left: 0, width: 100, height: 50, bottom: 50, right: 100 });
    document.body.appendChild(el);
    showHover(el);
    // bands exist and at least the margin band is shown (jsdom returns computed px)
    expect(document.getElementById("dm-hover-margin")).toBeTruthy();
    expect(document.getElementById("dm-hover-padding")).toBeTruthy();
  });

  it("hide + isOverlayElement work; destroy removes nodes", () => {
    const el = document.createElement("div");
    stubRect(el, { top: 0, left: 0, width: 10, height: 10, bottom: 10, right: 10 });
    document.body.appendChild(el);
    showHover(el); showSelect(el);
    expect(isOverlayElement(document.getElementById("dm-hover") as HTMLElement)).toBe(true);
    expect(isOverlayElement(el)).toBe(false);
    hideHover(); hideSelect();
    expect(document.getElementById("dm-hover")!.style.display).toBe("none");
    destroyOverlays();
    expect(document.getElementById("dm-hover")).toBeNull();
  });
});
