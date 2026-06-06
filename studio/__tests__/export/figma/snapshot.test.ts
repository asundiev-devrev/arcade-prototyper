// studio/__tests__/export/figma/snapshot.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import snapshot from "../../../src/export/figma/figma-variables.json";
import { buildTokenMap } from "../../../src/export/figma/tokenMap";

describe("variable snapshot integrity", () => {
  it("parses with the expected shape and is non-trivial", () => {
    expect(snapshot.fileKey).toBe("a2uKnm88LxRXEWAL1kOqeQ");
    expect(Array.isArray(snapshot.variables)).toBe(true);
    expect(snapshot.variables.length).toBeGreaterThan(500);
    for (const v of snapshot.variables.slice(0, 20)) {
      expect(typeof v.name).toBe("string");
      expect(typeof v.key).toBe("string");
    }
  });

  it("resolves the common semantic color families against the REAL snapshot", () => {
    const map = buildTokenMap(snapshot.variables);
    for (const t of ["--fg-neutral-prominent", "--bg-neutral-soft", "--stroke-neutral-subtle", "--surface-overlay"]) {
      expect(map.tokenNameToVariableKey(t), t).not.toBeNull();
    }
  });

  it("resolves a component-level token (e.g. the bubble self bg)", () => {
    const map = buildTokenMap(snapshot.variables);
    // Bubble/Self/BG normalizes to "bubbleselfbg" which matches --bubble-self-bg style names
    expect(map.tokenNameToVariableKey("--bubble-self-bg")).not.toBeNull();
  });
});
