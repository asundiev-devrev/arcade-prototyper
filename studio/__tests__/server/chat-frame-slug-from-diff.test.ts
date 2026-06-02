import { describe, it, expect } from "vitest";
import { frameSlugFromDiff } from "../../server/middleware/chat";

describe("frameSlugFromDiff", () => {
  it("prefers an added frame", () => {
    expect(
      frameSlugFromDiff({ added: ["frames/02-new/index.tsx"], changed: ["frames/01-old/index.tsx"], removed: [] }),
    ).toBe("02-new");
  });
  it("falls back to a changed frame", () => {
    expect(
      frameSlugFromDiff({ added: [], changed: ["frames/01-old/index.tsx"], removed: [] }),
    ).toBe("01-old");
  });
  it("ignores non-frame paths", () => {
    expect(frameSlugFromDiff({ added: ["shared/util.ts"], changed: [], removed: [] })).toBeNull();
  });
});
