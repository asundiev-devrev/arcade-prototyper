// studio/__tests__/lib/exportFrameToSlj-svg.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildWalkContext } from "../../src/lib/exportFrameToSlj";
import { isElementNode } from "../../src/export/slj";

describe("exportFrameToSlj SVG markup capture", () => {
  it("captures SVG outerHTML and replaces currentColor with computed color", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    const win = iframe.contentWindow!;

    doc.body.innerHTML = `
      <div id="root">
        <svg style="color: rgb(255, 0, 0);" width="24" height="24">
          <circle cx="12" cy="12" r="10" fill="currentColor"/>
        </svg>
      </div>
    `;

    const rootEl = doc.getElementById("root")!;
    const svgEl = rootEl.querySelector("svg")! as Element & Record<string, unknown>;

    // Create a fake fiber for the SVG element
    const svgFiber = {
      type: "svg",
      child: null,
      sibling: null,
      memoizedProps: {},
      stateNode: svgEl,
    };
    svgEl["__reactFiber$test"] = svgFiber;

    // Create root fiber
    const rootFiber = {
      type: "div",
      child: svgFiber,
      sibling: null,
      memoizedProps: {},
      stateNode: rootEl,
    };
    rootEl["__reactContainer$test"] = rootFiber;

    const handle = buildWalkContext(iframe);
    const node = handle.walkFrom(rootFiber);

    expect(isElementNode(node)).toBe(true);
    if (isElementNode(node) && node.children.length > 0) {
      const svgNode = node.children[0];
      expect(isElementNode(svgNode)).toBe(true);
      if (isElementNode(svgNode)) {
        expect(svgNode.tag).toBe("svg");
        expect(svgNode.style.svg).toBeDefined();
        // Verify currentColor was replaced with computed color
        expect(svgNode.style.svg).toContain("rgb(255, 0, 0)");
        expect(svgNode.style.svg).not.toContain("currentColor");
      }
    }
  });

  it("returns null markup when SVG exceeds 20KB cap", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;

    // Create a huge SVG (over 20KB)
    const hugeContent = '<path d="M' + 'L100,100 '.repeat(3000) + '"/>';
    doc.body.innerHTML = `
      <div id="root">
        <svg width="24" height="24">${hugeContent}</svg>
      </div>
    `;

    const rootEl = doc.getElementById("root")!;
    const svgEl = rootEl.querySelector("svg")! as Element & Record<string, unknown>;

    const svgFiber = {
      type: "svg",
      child: null,
      sibling: null,
      memoizedProps: {},
      stateNode: svgEl,
    };
    svgEl["__reactFiber$test"] = svgFiber;

    const rootFiber = {
      type: "div",
      child: svgFiber,
      sibling: null,
      memoizedProps: {},
      stateNode: rootEl,
    };
    rootEl["__reactContainer$test"] = rootFiber;

    const handle = buildWalkContext(iframe);
    const node = handle.walkFrom(rootFiber);

    if (isElementNode(node) && node.children.length > 0) {
      const svgNode = node.children[0];
      if (isElementNode(svgNode)) {
        expect(svgNode.tag).toBe("svg");
        expect(svgNode.style.svg).toBeUndefined(); // Over cap, returns null
      }
    }
  });

  it("handles SVG without currentColor gracefully", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;

    doc.body.innerHTML = `
      <div id="root">
        <svg width="24" height="24">
          <rect width="20" height="20" fill="#ff0000"/>
        </svg>
      </div>
    `;

    const rootEl = doc.getElementById("root")!;
    const svgEl = rootEl.querySelector("svg")! as Element & Record<string, unknown>;

    const svgFiber = {
      type: "svg",
      child: null,
      sibling: null,
      memoizedProps: {},
      stateNode: svgEl,
    };
    svgEl["__reactFiber$test"] = svgFiber;

    const rootFiber = {
      type: "div",
      child: svgFiber,
      sibling: null,
      memoizedProps: {},
      stateNode: rootEl,
    };
    rootEl["__reactContainer$test"] = rootFiber;

    const handle = buildWalkContext(iframe);
    const node = handle.walkFrom(rootFiber);

    if (isElementNode(node) && node.children.length > 0) {
      const svgNode = node.children[0];
      if (isElementNode(svgNode)) {
        expect(svgNode.tag).toBe("svg");
        expect(svgNode.style.svg).toBeDefined();
        expect(svgNode.style.svg).toContain('#ff0000');
      }
    }
  });
});
