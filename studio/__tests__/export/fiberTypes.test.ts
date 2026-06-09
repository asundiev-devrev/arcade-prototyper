// studio/__tests__/export/fiberTypes.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { fiberName, type MinimalFiber } from "../../src/export/fiberTypes";

describe("fiberName", () => {
  it("reads a function component name", () => {
    expect(fiberName({ type: function ChatBubble() {}, child: null, sibling: null, memoizedProps: {} } as MinimalFiber)).toBe("ChatBubble");
  });
  it("prefers displayName over name", () => {
    const fn: any = function X() {}; fn.displayName = "ComputerSidebar.Item";
    expect(fiberName({ type: fn, child: null, sibling: null, memoizedProps: {} } as MinimalFiber)).toBe("ComputerSidebar.Item");
  });
  it("reads forwardRef/memo object component via render name", () => {
    const obj: any = { render: function IconButton() {} };
    expect(fiberName({ type: obj, child: null, sibling: null, memoizedProps: {} } as MinimalFiber)).toBe("IconButton");
  });
  it("returns null for host string types and text", () => {
    expect(fiberName({ type: "div", child: null, sibling: null, memoizedProps: {} } as MinimalFiber)).toBeNull();
    expect(fiberName({ type: null, child: null, sibling: null, memoizedProps: {} } as MinimalFiber)).toBeNull();
  });
});
