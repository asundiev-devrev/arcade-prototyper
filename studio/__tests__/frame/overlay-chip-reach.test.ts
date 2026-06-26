// studio/__tests__/frame/overlay-chip-reach.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { showComponentChip, hideComponentChip } from "../../src/frame/overlay/overlays";

function rect(el: HTMLElement, r: Partial<DOMRect>) {
  el.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30, toJSON: () => ({}), ...r } as DOMRect);
}

describe("component chip reachability", () => {
  beforeEach(() => { document.documentElement.innerHTML = ""; hideComponentChip(); });

  it("never positions the chip above the top of the viewport", () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    rect(el, { top: 5, left: 40 }); // near the very top
    showComponentChip(el);
    const chip = document.querySelector("[data-arcade-component-chip]") as HTMLElement;
    const top = parseFloat(chip.style.top);
    expect(top).toBeGreaterThanOrEqual(0);   // clamped, not -19
  });
  it("the Customize target has an enlarged, pointer-enabled hit area", () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    rect(el, { top: 200, left: 40 });
    showComponentChip(el);
    const cust = document.querySelector("[data-arcade-customize]") as HTMLElement;
    expect(cust).toBeTruthy();
    expect(cust.style.pointerEvents).toBe("auto");
    // padded hit area (not a bare inline underline)
    expect(cust.style.padding === "" ? "" : cust.style.padding).not.toBe("");
  });
  it("chip itself has high z-index + pointer-events auto", () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    rect(el, { top: 200, left: 40 });
    showComponentChip(el);
    const chip = document.querySelector("[data-arcade-component-chip]") as HTMLElement;
    expect(Number(chip.style.zIndex)).toBeGreaterThan(2147483000);
    expect(chip.style.pointerEvents).toBe("auto");
  });
});
