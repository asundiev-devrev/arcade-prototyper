import { describe, it, expect } from "vitest";
import { hashSlug, truncate, stripPaths, sentryBeforeSend } from "../../../src/lib/telemetry/redact";

describe("redact", () => {
  it("hashSlug is stable + non-reversible", () => {
    const h = hashSlug("my-secret-project");
    expect(h).toBe(hashSlug("my-secret-project"));
    expect(h).not.toContain("secret");
    expect(h).toMatch(/^[a-f0-9]{12}$/);
  });

  it("truncate caps length and marks elision", () => {
    expect(truncate("x".repeat(300), 200)).toHaveLength(201);
    expect(truncate("short", 200)).toBe("short");
  });

  it("stripPaths removes arcade-studio project paths", () => {
    const msg = "ENOENT at /Users/me/Library/Application Support/arcade-studio/projects/foo/frames/a.tsx line 3";
    expect(stripPaths(msg)).not.toContain("/projects/foo/");
    expect(stripPaths(msg)).toContain("ENOENT");
  });

  it("sentryBeforeSend scrubs Authorization headers and prompt extras", () => {
    const event: any = {
      request: { headers: { Authorization: "Bearer secret", "Content-Type": "application/json" } },
      extra: { prompt: "my confidential idea", other: "kept" },
    };
    const out = sentryBeforeSend(event);
    expect(out.request.headers.Authorization).toBe("[redacted]");
    expect(out.extra.prompt).toBe("[redacted]");
    expect(out.extra.other).toBe("kept");
  });

  it("sentryBeforeSend scrubs home paths + token-shaped strings from message and stack", () => {
    const event: any = {
      message: "failed at /Users/jdoe/Library/Application Support/arcade-studio/projects/foo/x.tsx",
      exception: {
        values: [
          {
            value: "auth failed with token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
            stacktrace: { frames: [{ filename: "/Users/jdoe/app/main.ts", abs_path: "/Users/jdoe/app/main.ts" }] },
          },
        ],
      },
    };
    const out = sentryBeforeSend(event);
    expect(out.message).not.toContain("/Users/jdoe");
    expect(out.message).not.toContain("/projects/foo/");
    expect(out.exception.values[0].value).toContain("<gh-token>");
    expect(out.exception.values[0].value).not.toContain("ghp_ABCDEF");
    expect(out.exception.values[0].stacktrace.frames[0].filename).toBe("<home>/app/main.ts");
  });

  it("sentryBeforeSend never throws on malformed events", () => {
    expect(() => sentryBeforeSend({} as any)).not.toThrow();
    expect(() => sentryBeforeSend({ exception: { values: "nope" } } as any)).not.toThrow();
  });
});
