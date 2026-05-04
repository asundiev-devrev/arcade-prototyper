import { describe, it, expect } from "vitest";
import { deriveProjectName } from "../../src/lib/deriveProjectName";

describe("deriveProjectName", () => {
  it("returns 'Untitled project' for empty input", () => {
    expect(deriveProjectName("")).toBe("Untitled project");
    expect(deriveProjectName("   ")).toBe("Untitled project");
  });

  it("returns the trimmed prompt when short enough", () => {
    expect(deriveProjectName("  a landing page  ")).toBe("a landing page");
  });

  it("truncates at the last word boundary within 40 chars", () => {
    const input = "a landing page for a specialty coffee roasting shop";
    const out = deriveProjectName(input);
    expect(out).toBe("a landing page for a specialty coffee…");
    expect(out.length).toBeLessThanOrEqual(40 + 1); // +1 for ellipsis
  });

  it("hard-cuts when the first 40 chars contain no whitespace", () => {
    const input = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 43 a's
    const out = deriveProjectName(input);
    expect(out).toBe("a".repeat(40) + "…");
  });
});
