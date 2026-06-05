// studio/__tests__/lib/exportFrameToSlj.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { exportFrameToSlj } from "../../src/lib/exportFrameToSlj";

afterEach(() => vi.restoreAllMocks());

function fakeIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML =
    `<div id="root"><div data-arcade-component="ChatBubble" ` +
    `data-arcade-source="arcade/components" ` +
    `data-arcade-props='{"variant":"receiver"}'>Hi</div></div>`;
  return iframe;
}

describe("exportFrameToSlj", () => {
  it("serializes the iframe's mount root and POSTs the SLJ to the endpoint", async () => {
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

    expect(slj.slj).toBe(1);
    expect(slj.frame).toEqual({ slug: "01-bubble", project: "demo", width: 1440, mode: "light" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/demo/export/01-bubble.slj.json",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws a clear error when the iframe document is unreachable", async () => {
    const iframe = document.createElement("iframe");
    Object.defineProperty(iframe, "contentDocument", { value: null });
    await expect(
      exportFrameToSlj({ iframe, projectSlug: "d", frameSlug: "f", mode: "light", width: 100 }),
    ).rejects.toThrow(/iframe/i);
  });
});
