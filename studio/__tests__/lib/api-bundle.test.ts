import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "../../src/lib/api";

afterEach(() => vi.restoreAllMocks());

describe("api.importProject", () => {
  it("POSTs raw bytes to the import route and returns the project", async () => {
    const project = { slug: "x", name: "X (imported)" };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(project), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array([1, 2, 3])], "x.arcade");
    const out = await api.importProject(file);
    expect(out.slug).toBe("x");
    const [urlArg, init] = fetchMock.mock.calls[0];
    expect(urlArg).toBe("/api/projects/import");
    expect(init?.method).toBe("POST");
  });
});

describe("api.exportProject", () => {
  it("navigates to the export URL", () => {
    // Robust in jsdom: redefine location with a capturing href setter.
    const captured: { href?: string } = {};
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, set href(v: string) { captured.href = v; }, get href() { return captured.href ?? ""; } },
    });
    api.exportProject("my-slug");
    expect(captured.href).toBe("/api/projects/my-slug/export");
  });
});
