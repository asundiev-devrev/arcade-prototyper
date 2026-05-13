// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  deployViaWorker,
  normalizeBranchName,
  normalizeProjectName,
} from "../../../server/cloudflare/deploy";

const originalFetch = globalThis.fetch;

describe("normalizeProjectName", () => {
  it("leaves clean kebab-case slugs untouched", () => {
    expect(normalizeProjectName("my-project")).toBe("my-project");
  });

  it("lowercases mixed-case input", () => {
    expect(normalizeProjectName("MyProject")).toBe("myproject");
  });

  it("replaces disallowed chars with hyphens", () => {
    expect(normalizeProjectName("foo bar_baz")).toBe("foo-bar-baz");
  });

  it("trims leading/trailing hyphens", () => {
    expect(normalizeProjectName("--foo--")).toBe("foo");
  });

  it("prepends 'p-' when result starts with a digit", () => {
    expect(normalizeProjectName("123abc")).toBe("p-123abc");
  });

  it("caps length at 58 chars", () => {
    expect(normalizeProjectName("a".repeat(100)).length).toBe(58);
  });

  it("falls back to 'arcade-frame' on empty input", () => {
    expect(normalizeProjectName("")).toBe("arcade-frame");
    expect(normalizeProjectName("---")).toBe("arcade-frame");
  });
});

describe("normalizeBranchName", () => {
  it("leaves clean branch names untouched", () => {
    expect(normalizeBranchName("hero")).toBe("hero");
  });

  it("lowercases + strips disallowed chars", () => {
    expect(normalizeBranchName("Hero Frame_1")).toBe("hero-frame-1");
  });

  it("caps length at 28 chars", () => {
    expect(normalizeBranchName("a".repeat(100)).length).toBe(28);
  });

  it("falls back to 'frame' on empty input", () => {
    expect(normalizeBranchName("")).toBe("frame");
  });
});

describe("deployViaWorker", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as any;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs to <workerUrl>/share with Bearer auth and the expected body", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(
        JSON.stringify({ url: "https://hero.p.pages.dev", deployId: "d1" }),
        { status: 200 },
      ),
    );

    const result = await deployViaWorker({
      shareKey: "abc123",
      pagesProjectName: "my-proj",
      branch: "hero",
      projectSlug: "my-project",
      files: [{ file: "index.html", data: "<html></html>" }],
      workerUrl: "https://worker.example",
    });

    expect(result).toEqual({ url: "https://hero.p.pages.dev", deployId: "d1" });

    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://worker.example/share");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer abc123");

    const body = JSON.parse(init.body);
    expect(body.pagesProjectName).toBe("my-proj");
    expect(body.branch).toBe("hero");
    expect(body.projectSlug).toBe("my-project");
    expect(body.files).toEqual([{ file: "index.html", data: "<html></html>" }]);
  });

  it("throws an error that carries the Worker's error.code and status", async () => {
    // The middleware reads err.code to decide whether to surface a 401 to
    // the UI (invalid_key / missing_key) vs. a generic 500 (anything else).
    // Regression guard: if we lose these fields, the UI stops showing the
    // "configure your share key" path and users see a confusing 500.
    (globalThis.fetch as any).mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "invalid_key", message: "nope" } }),
        { status: 401 },
      ),
    );

    try {
      await deployViaWorker({
        shareKey: "bad",
        pagesProjectName: "p",
        branch: "b",
        projectSlug: "p",
        files: [{ file: "index.html", data: "x" }],
        workerUrl: "https://worker.example",
      });
      throw new Error("expected deployViaWorker to throw");
    } catch (err: any) {
      expect(err.message).toBe("nope");
      expect(err.code).toBe("invalid_key");
      expect(err.status).toBe(401);
    }
  });
});
