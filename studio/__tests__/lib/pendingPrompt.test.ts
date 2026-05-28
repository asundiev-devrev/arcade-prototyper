// studio/__tests__/lib/pendingPrompt.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  setPendingPrompt,
  takePendingPrompt,
  clearPendingPrompt,
  __resetPendingPromptForTests,
} from "../../src/lib/pendingPrompt";

describe("pendingPrompt", () => {
  beforeEach(() => {
    __resetPendingPromptForTests();
  });

  it("returns undefined when no pending prompt is set", () => {
    expect(takePendingPrompt("missing")).toBeUndefined();
  });

  it("set then take returns the value once and clears it", () => {
    setPendingPrompt("alpha", { prompt: "hi", imagePaths: [], figmaUrl: null });
    const first = takePendingPrompt("alpha");
    expect(first).toEqual({ prompt: "hi", imagePaths: [], figmaUrl: null });
    const second = takePendingPrompt("alpha");
    expect(second).toBeUndefined();
  });

  it("clearPendingPrompt removes without consuming", () => {
    setPendingPrompt("beta", {
      prompt: "p",
      imagePaths: ["/tmp/x.png"],
      figmaUrl: "https://figma.com/abc",
    });
    clearPendingPrompt("beta");
    expect(takePendingPrompt("beta")).toBeUndefined();
  });

  it("each slug has its own slot", () => {
    setPendingPrompt("a", { prompt: "A", imagePaths: [], figmaUrl: null });
    setPendingPrompt("b", { prompt: "B", imagePaths: [], figmaUrl: null });
    expect(takePendingPrompt("b")?.prompt).toBe("B");
    expect(takePendingPrompt("a")?.prompt).toBe("A");
  });
});
