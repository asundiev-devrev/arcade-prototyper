// studio/__tests__/frame/overlay-chip.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { showComponentChip, hideComponentChip } from "../../src/frame/overlay/overlays";

describe("component chip", () => {
  beforeEach(() => { document.documentElement.innerHTML = ""; });
  it("renders a chip with the exact label and a Customize click target", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ x: 10, y: 20, width: 100, height: 40, top: 20, left: 10, right: 110, bottom: 60, toJSON: () => ({}) } as DOMRect);
    showComponentChip(el);
    const chip = document.querySelector("[data-arcade-component-chip]") as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain("💠 Component");
    const cust = chip.querySelector("[data-arcade-customize]") as HTMLElement;
    expect(cust).toBeTruthy();
    expect(cust.textContent).toContain("Customize");
  });
  it("clicking Customize posts a customize-request to the parent", () => {
    const post = vi.fn();
    (window as any).parent = { postMessage: post };
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, toJSON: () => ({}) } as DOMRect);
    showComponentChip(el);
    (document.querySelector("[data-arcade-customize]") as HTMLElement).click();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "arcade-studio:customize-request" }), "*");
  });
  it("hideComponentChip removes it", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ x: 0, y: 0, width: 1, height: 1, top: 0, left: 0, right: 1, bottom: 1, toJSON: () => ({}) } as DOMRect);
    showComponentChip(el); hideComponentChip();
    expect(document.querySelector("[data-arcade-component-chip]")).toBeNull();
  });
});
