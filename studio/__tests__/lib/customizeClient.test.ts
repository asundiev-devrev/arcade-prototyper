import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildCustomizePayload, postCustomize, postCustomizeUndo } from "../../src/lib/customizeClient";

describe("buildCustomizePayload", () => {
  it("assembles the endpoint payload", () => {
    const p = buildCustomizePayload({ componentName: "ComputerScene", line: 6, column: 5 }, "<div>x</div>", "01-x");
    expect(p).toEqual({ frameSlug: "01-x", targetComponentName: "ComputerScene", line: 6, column: 5, jsx: "<div>x</div>" });
  });
});

describe("postCustomize / postCustomizeUndo", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  it("POSTs the payload and returns the parsed body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const r = await postCustomize("demo", { frameSlug: "01-x", targetComponentName: "C", line: 1, column: 1, jsx: "<div/>" });
    expect(fetchMock).toHaveBeenCalledWith("/api/customize/demo", expect.objectContaining({ method: "POST" }));
    expect(r).toEqual({ ok: true });
  });
  it("returns ok:false on network throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const r = await postCustomize("demo", { frameSlug: "01-x", targetComponentName: "C", line: 1, column: 1, jsx: "<div/>" });
    expect(r.ok).toBe(false);
  });
  it("undo POSTs to the undo route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    await postCustomizeUndo("demo", "01-x");
    expect(fetchMock).toHaveBeenCalledWith("/api/customize/demo/undo", expect.objectContaining({ method: "POST" }));
  });
});
