// studio/__tests__/lib/serializeFrameForExport.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { serializeFrameForExport } from "../../src/lib/serializeFrameForExport";

describe("serializeFrameForExport", () => {
  it("mounts a hidden iframe, runs the serializer on load, and cleans up", async () => {
    const fakeSlj = { slj: 1, frame: { slug: "f", project: "p", width: 1280, mode: "light" }, root: {} };
    const serialize = vi.fn(async () => fakeSlj as any);

    const promise = serializeFrameForExport(
      { projectSlug: "p", frameSlug: "f", width: 1280, mode: "light" },
      { serialize, settleMs: 0 },
    );

    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toContain("/api/frames/p/f");

    iframe!.dispatchEvent(new Event("load"));

    const result = await promise;
    expect(result).toBe(fakeSlj);
    expect(serialize).toHaveBeenCalledOnce();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("rejects if the iframe never loads within the timeout", async () => {
    await expect(
      serializeFrameForExport(
        { projectSlug: "p", frameSlug: "f", width: 1280, mode: "light" },
        { serialize: async () => ({} as any), settleMs: 0, loadTimeoutMs: 10 },
      ),
    ).rejects.toThrow(/timed out/i);
    expect(document.querySelector("iframe")).toBeNull();
  });
});
