// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveCustomizeTarget } from "../../src/frame/resolveCustomizeTarget";

// This test validates the decision + payload wiring without a live iframe.
// The live fiber walk (serializeTargetToJsx) is the human manual gate.
describe("customize flow decision", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves target then builds a payload from a component selection", async () => {
    const { buildCustomizePayload, postCustomize } = await import("../../src/lib/customizeClient");
    const target = resolveCustomizeTarget(
      [{ componentName: "Agent", file: "/x/prototype-kit/y.js", line: 1, column: 1 },
       { componentName: "ComputerScene", file: "/p/projects/demo/frames/01-c/index.tsx", line: 4, column: 6 }],
      "01-c",
    )!;
    expect(target.componentName).toBe("ComputerScene");
    const payload = buildCustomizePayload(target, `<div>x</div>`, "01-c");
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const r = await postCustomize("demo", payload);
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/customize/demo");
  });

  it("falls back (returns null target) when no owner is authored in the frame", () => {
    // chain is entirely shared kit code — no /frames/<slug>/ anchor
    const target = resolveCustomizeTarget(
      [{ componentName: "Agent", file: "/x/prototype-kit/y.js", line: 1, column: 1 }],
      "01-c",
    );
    expect(target).toBeNull();
  });

  it("postCustomize reports !ok when the server declines (no file change)", async () => {
    const { buildCustomizePayload, postCustomize } = await import("../../src/lib/customizeClient");
    const target = resolveCustomizeTarget(
      [{ componentName: "ComputerScene", file: "/p/frames/01-c/index.tsx", line: 4, column: 6 }],
      "01-c",
    )!;
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: false, reason: "reparse" }) });
    vi.stubGlobal("fetch", fetchMock);
    const r = await postCustomize("demo", buildCustomizePayload(target, "<div/>", "01-c"));
    expect(r.ok).toBe(false);
  });

  it("postCustomizeUndo posts to the /undo route with the frame slug", async () => {
    const { postCustomizeUndo } = await import("../../src/lib/customizeClient");
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const r = await postCustomizeUndo("demo", "01-c");
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/customize/demo/undo");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ frameSlug: "01-c" });
  });
});
