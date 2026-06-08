// studio/__tests__/lib/exportFrameToSlj.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { exportFrameToSlj } from "../../src/lib/exportFrameToSlj";
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
});
