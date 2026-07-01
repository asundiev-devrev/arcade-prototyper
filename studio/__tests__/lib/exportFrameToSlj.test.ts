// studio/__tests__/lib/exportFrameToSlj.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { exportFrameToSlj, buildWalkContext } from "../../src/lib/exportFrameToSlj";
import { SLJ_VERSION } from "../../src/export/slj";

afterEach(() => vi.restoreAllMocks());

// A host-div fiber whose stateNode is a real Element, so walkFiber yields an
// element node and the live hostOf() (instanceof win.Element) resolves it.
function fakeFiber(el: Element) {
  return { type: "div", child: null, sibling: null, memoizedProps: {}, stateNode: el, return: null };
}

/** Build a jsdom iframe with a #root + mounted child carrying a fake React fiber. */
function fakeIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = `<div id="root"><div>Hi</div></div>`;
  const mount = doc.getElementById("root")!.firstElementChild! as Element & Record<string, unknown>;
  // The export reaches the fiber via a __reactFiber$* key on the mount node.
  mount["__reactFiber$test"] = fakeFiber(mount);
  return iframe;
}

describe("exportFrameToSlj", () => {
  it("walks the iframe's React tree and POSTs the SLJ to the endpoint", async () => {
    const iframe = fakeIframe();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    const slj = await exportFrameToSlj({
      iframe,
      projectSlug: "demo",
      frameSlug: "01-bubble",
      mode: "light",
      width: 1440,
    });

    expect(slj.slj).toBe(SLJ_VERSION);
    expect(slj.frame).toEqual({ slug: "01-bubble", project: "demo", width: 1440, mode: "light" });
    expect(slj.root).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/demo/export/01-bubble.slj.json",
      expect.objectContaining({ method: "POST" }),
    );
    // The POSTed body is the same SLJ envelope, serialized.
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ slj: SLJ_VERSION, frame: { slug: "01-bubble", project: "demo" } });
  });

  it("throws a clear error when the iframe document is unreachable", async () => {
    const iframe = document.createElement("iframe");
    Object.defineProperty(iframe, "contentDocument", { value: null });
    await expect(
      exportFrameToSlj({ iframe, projectSlug: "d", frameSlug: "f", mode: "light", width: 100 }),
    ).rejects.toThrow(/iframe/i);
  });

  it("walks the FiberRoot.current, not the mount-time container fiber", async () => {
    // React double-buffers root fibers: the container key is stamped at mount and
    // may point to a stale HostRoot whose child is null. The committed tree lives
    // on stateNode.current (possibly the alternate fiber). This test simulates that
    // scenario: the containerKey fiber is stale (child: null), but its
    // stateNode.current points to the live tree with a real child.
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML = `<div id="root"><div>Live content</div></div>`;
    const mount = doc.getElementById("root")!.firstElementChild! as Element & Record<string, unknown>;

    const mountEl = doc.getElementById("root")!.firstElementChild!;
    const liveChild = fakeFiber(mountEl as Element);
    const liveRoot = { type: "HostRoot", child: liveChild, sibling: null, memoizedProps: {}, stateNode: null, return: null };
    const fiberRoot = { current: liveRoot };
    const staleRoot = { type: "HostRoot", child: null, sibling: null, memoizedProps: {}, stateNode: fiberRoot, return: null };
    const rootContainer = doc.getElementById("root")! as Element & Record<string, unknown>;
    rootContainer["__reactContainer$test"] = staleRoot;

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    const slj = await exportFrameToSlj({
      iframe,
      projectSlug: "demo",
      frameSlug: "01-bubble",
      mode: "light",
      width: 1440,
    });

    // The walk should see the live tree (child present), not an empty root.
    expect(slj.root).toBeTruthy();
    expect(slj.root.children).toBeTruthy();
    expect(slj.root.children?.length).toBeGreaterThan(0);
  });

  it("uses the original fiber when stateNode.current is absent (older React or test fakes)", async () => {
    // Sanity check: if stateNode is not a FiberRoot (older shape or test fakes),
    // the walk should use the original fiber without crashing.
    const iframe = fakeIframe();
    const rootContainer = iframe.contentDocument!.getElementById("root")! as Element & Record<string, unknown>;
    const origFiber = rootContainer["__reactFiber$test"] || rootContainer["__reactContainer$test"];
    // Ensure no FiberRoot normalization is possible: stateNode is a DOM element.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    const slj = await exportFrameToSlj({
      iframe,
      projectSlug: "demo",
      frameSlug: "01-bubble",
      mode: "light",
      width: 1440,
    });

    expect(slj.root).toBeTruthy();
  });

  it("emits direct text only once when wrapper fibers share the same host element", () => {
    // Regression test for commit b1936ed: a chain of component wrapper fibers
    // (Radix primitives like TabsTrigger → RovingFocusGroupItem → Slot →
    // SlotClone → Primitive.span, ~11 levels) all resolving via hostOf to the
    // SAME host element caused directText to return the same text N times — once
    // per wrapper level — producing overlapping duplicates in Figma ("General"
    // ×11, "Desktop app" ×11).
    //
    // The fix: directText must return non-null ONLY when the fiber ITSELF owns
    // the host element (f.stateNode instanceof win.Element), not when hostOf
    // merely descends to one.

    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    const win = iframe.contentWindow as Window & typeof globalThis;

    // Build DOM: a single host element with direct text + an element child
    doc.body.innerHTML = `<div id="root"><span>Direct text here</span><em>child</em></div>`;
    const rootEl = doc.getElementById("root")!;
    const spanHost = rootEl.firstElementChild! as Element;
    const emChild = spanHost.nextElementSibling! as Element;

    // Build fake fiber chain: wrapper1 → wrapper2 → hostFiber (stateNode: spanHost)
    // Each wrapper has stateNode: null; only the bottom fiber owns the host element.
    const hostFiber = {
      type: "span",
      child: null,
      sibling: { type: "em", child: null, sibling: null, memoizedProps: {}, stateNode: emChild, return: null },
      memoizedProps: {},
      stateNode: spanHost,
      return: null,
    };

    const wrapper2 = {
      type: function SlotClone() {},
      child: hostFiber,
      sibling: null,
      memoizedProps: {},
      stateNode: null, // wrapper: no host
      return: null,
    };

    const wrapper1 = {
      type: function Slot() {},
      child: wrapper2,
      sibling: null,
      memoizedProps: {},
      stateNode: null, // wrapper: no host
      return: null,
    };

    const rootFiber = {
      type: "div",
      child: wrapper1,
      sibling: null,
      memoizedProps: {},
      stateNode: rootEl,
      return: null,
    };

    const fiberRoot = { current: rootFiber };
    const containerFiber = { type: "HostRoot", child: rootFiber, sibling: null, memoizedProps: {}, stateNode: fiberRoot, return: null };
    (rootEl as any)["__reactContainer$test"] = containerFiber;

    const handle = buildWalkContext(iframe);
    const slj = handle.walkFrom(handle.rootFiber);

    // Walk the tree and count how many text nodes have "Direct text here"
    let directTextCount = 0;
    const visit = (node: any) => {
      if (node.kind === "element" && node.tag === "text" && node.style?.characters === "Direct text here") {
        directTextCount++;
      }
      if (node.children) node.children.forEach(visit);
    };
    visit(slj);

    // Should appear EXACTLY once, not once per wrapper level
    expect(directTextCount).toBe(1);
  });
});
