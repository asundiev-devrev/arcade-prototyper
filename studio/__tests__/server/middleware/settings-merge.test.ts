// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mergeSettings } from "../../../server/middleware/settings";

describe("mergeSettings", () => {
  it("preserves top-level keys that are absent from the patch", () => {
    const base = { vercel: { token: "v" }, studio: { mode: "dark" } };
    expect(mergeSettings(base, { devrev: { user: { id: "u" } } })).toEqual({
      vercel: { token: "v" },
      studio: { mode: "dark" },
      devrev: { user: { id: "u" } },
    });
  });

  it("deep-merges nested objects instead of replacing them", () => {
    const base = { studio: { mode: "dark", model: "opus" } };
    const next = mergeSettings(base, { studio: { model: "sonnet" } });
    expect(next.studio).toEqual({ mode: "dark", model: "sonnet" });
  });

  it("null explicitly unsets a nested key without clobbering siblings", () => {
    const base = { studio: { mode: "dark", model: "opus" } };
    const next = mergeSettings(base, { studio: { model: null } });
    expect(next.studio).toEqual({ mode: "dark" });
    expect("model" in (next.studio as any)).toBe(false);
  });

  it("null at top level deletes the whole nested object", () => {
    const base = { studio: { mode: "dark" }, vercel: { token: "v" } };
    expect(mergeSettings(base, { vercel: null })).toEqual({
      studio: { mode: "dark" },
    });
  });

  it("arrays replace rather than merge", () => {
    const base = { deployments: [{ url: "a" }] };
    expect(mergeSettings(base, { deployments: [{ url: "b" }] })).toEqual({
      deployments: [{ url: "b" }],
    });
  });
});
