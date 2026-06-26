import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { activate, deactivate } from "../../src/frame/picker";
import { showComponentChip, hideComponentChip } from "../../src/frame/overlay/overlays";

/**
 * REGRESSION: the picker stays active for bulk picking, so its document-level
 * capture `click` listener fires on EVERY click in the frame — including a click
 * on the Customize chip (a raw DOM node with no React fiber). Before the fix,
 * that click reached the picker, found no fiber, and posted
 * `frame-pick-cancelled` reason "no-fiber" → the red "That's not a React
 * element we can target" toast. The picker must IGNORE overlay elements (the
 * chip) on click, exactly as it already does on hover.
 */
describe("picker ignores the component chip on click", () => {
  let posts: any[];
  beforeEach(() => {
    document.documentElement.innerHTML = "";
    posts = [];
    (window as any).parent = { postMessage: (m: any) => posts.push(m) };
    activate();
  });
  afterEach(() => {
    deactivate();
    hideComponentChip();
  });

  it("clicking the chip's Customize does NOT post frame-pick-cancelled(no-fiber)", () => {
    // a selected element + its chip
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 100, height: 30, top: 200, left: 40, right: 140, bottom: 230, toJSON: () => ({}) } as DOMRect);
    showComponentChip(el);

    const cust = document.querySelector("[data-arcade-customize]") as HTMLElement;
    expect(cust).toBeTruthy();
    cust.click();

    const cancelled = posts.find(
      (m) => m?.type === "arcade-studio:frame-pick-cancelled" && m?.reason === "no-fiber",
    );
    expect(cancelled).toBeUndefined();
  });

  it("clicking the chip container itself is also ignored", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 80, height: 20, top: 100, left: 10, right: 90, bottom: 120, toJSON: () => ({}) } as DOMRect);
    showComponentChip(el);

    const chip = document.querySelector("[data-arcade-component-chip]") as HTMLElement;
    chip.click();

    const cancelled = posts.find(
      (m) => m?.type === "arcade-studio:frame-pick-cancelled" && m?.reason === "no-fiber",
    );
    expect(cancelled).toBeUndefined();
  });
});
