// studio/__tests__/export/figma/tokenMap.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildTokenMap, OVERRIDES } from "../../../src/export/figma/tokenMap";

const SNAPSHOT = [
  { name: "FG/Neutral/Prominent", key: "k-fg-neutral-prominent", type: "COLOR", collection: "Mode" },
  { name: "BG/Neutral/Soft", key: "k-bg-neutral-soft", type: "COLOR", collection: "Mode" },
  { name: "Stroke/Neutral/Subtle", key: "k-stroke-neutral-subtle", type: "COLOR", collection: "Mode" },
  { name: "Bubble/Self/BG", key: "k-bubble-self-bg", type: "COLOR", collection: "Component" },
];

describe("tokenMap", () => {
  it("maps a CSS token to its variable key by normalized name compare", () => {
    const map = buildTokenMap(SNAPSHOT);
    expect(map.tokenNameToVariableKey("--fg-neutral-prominent")).toBe("k-fg-neutral-prominent");
    expect(map.tokenNameToVariableKey("--bg-neutral-soft")).toBe("k-bg-neutral-soft");
    expect(map.tokenNameToVariableKey("--stroke-neutral-subtle")).toBe("k-stroke-neutral-subtle");
  });

  it("is robust to slash/dash/case differences", () => {
    const map = buildTokenMap(SNAPSHOT);
    expect(map.tokenNameToVariableKey("--FG-Neutral-Prominent")).toBe("k-fg-neutral-prominent");
  });

  it("returns null for an unknown token", () => {
    const map = buildTokenMap(SNAPSHOT);
    expect(map.tokenNameToVariableKey("--does-not-exist")).toBeNull();
  });

  it("applies an override before the naming rule", () => {
    const map = buildTokenMap(SNAPSHOT, { "--chat-bubble-mine": "Bubble/Self/BG" });
    expect(map.tokenNameToVariableKey("--chat-bubble-mine")).toBe("k-bubble-self-bg");
  });

  it("OVERRIDES is an object (the committed override list)", () => {
    expect(typeof OVERRIDES).toBe("object");
  });
});
