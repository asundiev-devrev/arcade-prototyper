// studio/__tests__/lib/exportFrameToSlj-container.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildWalkContext } from "../../src/lib/exportFrameToSlj";

/** Build a minimal fake fiber tree: HostRoot → component → child(ren). */
function buildFiberTree(componentName: string, hasChildren: boolean): {
  rootFiber: any;
  iframe: HTMLIFrameElement;
} {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;

  // Create DOM structure
  doc.body.innerHTML = `<div id="root"><div class="container"><div class="child">Content</div></div></div>`;
  const rootEl = doc.getElementById("root")!;
  const containerEl = rootEl.firstElementChild! as Element;
  const childEl = containerEl.firstElementChild! as Element;

  // Build fiber tree: HostRoot → named component fiber → child element fiber
  const childFiber = {
    type: "div",
    child: null,
    sibling: null,
    memoizedProps: {},
    stateNode: childEl,
    return: null,
  };

  // Create a function component type (fiberName checks type.name for functions)
  const componentType = function() {};
  Object.defineProperty(componentType, 'name', { value: componentName });

  const componentFiber = {
    type: componentType,
    child: hasChildren ? childFiber : null,
    sibling: null,
    memoizedProps: {},
    stateNode: containerEl,
    return: null,
  };

  const hostRootChild = {
    type: "div",
    child: componentFiber,
    sibling: null,
    memoizedProps: {},
    stateNode: rootEl,
    return: null,
  };

  const hostRoot = {
    type: "HostRoot",
    child: hostRootChild,
    sibling: null,
    memoizedProps: {},
    stateNode: null,
    return: null,
  };

  // Attach via __reactContainer$ to match the real buildWalkContext pattern
  (rootEl as any)["__reactContainer$test"] = hostRoot;

  return { rootFiber: hostRoot, iframe };
}

describe("exportFrameToSlj container component classification", () => {
  it("classifies Tabs as composite (recurse) when container: true", () => {
    const { iframe } = buildFiberTree("Tabs", true);
    const handle = buildWalkContext(iframe);
    const slj = handle.walkFrom(handle.rootFiber);

    // Tabs should recurse into a frame with real children, NOT prune into a component node
    // Walk through: root → root div → Tabs fiber → should be element, not component
    expect(slj.kind).toBe("element");
    expect(slj.children).toBeTruthy();
    const firstChild = slj.children?.[0];
    expect(firstChild).toBeTruthy();

    // The Tabs component fiber should produce an element node (frame) with children,
    // not a component node. Navigate: root element → container (Tabs becomes element)
    const container = firstChild?.children?.[0];
    expect(container?.kind).toBe("element");
    expect(container?.children?.length).toBeGreaterThan(0);
  });

  it("classifies Button as primitive (prune) even with children", () => {
    const { iframe } = buildFiberTree("Button", true);
    const handle = buildWalkContext(iframe);
    const slj = handle.walkFrom(handle.rootFiber);

    // Button should prune into a component node, NOT recurse
    // Navigate through the tree
    expect(slj.kind).toBe("element");
    const firstChild = slj.children?.[0];
    expect(firstChild).toBeTruthy();

    // The Button fiber should produce a component node (pruned), not an element
    const button = firstChild?.children?.[0];
    expect(button?.kind).toBe("component");
    expect(button).toMatchObject({ kind: "component", component: "Button" });
  });

  it("classifies Modal as composite (recurse) when container: true", () => {
    const { iframe } = buildFiberTree("Modal", true);
    const handle = buildWalkContext(iframe);
    const slj = handle.walkFrom(handle.rootFiber);

    // Modal should recurse into a frame with real children
    expect(slj.kind).toBe("element");
    const firstChild = slj.children?.[0];
    const modal = firstChild?.children?.[0];
    expect(modal?.kind).toBe("element");
    expect(modal?.children?.length).toBeGreaterThan(0);
  });

  it("classifies Popover as composite (recurse) when container: true", () => {
    const { iframe } = buildFiberTree("Popover", true);
    const handle = buildWalkContext(iframe);
    const slj = handle.walkFrom(handle.rootFiber);

    // Popover should recurse into a frame with real children
    expect(slj.kind).toBe("element");
    const firstChild = slj.children?.[0];
    const popover = firstChild?.children?.[0];
    expect(popover?.kind).toBe("element");
    expect(popover?.children?.length).toBeGreaterThan(0);
  });
});
