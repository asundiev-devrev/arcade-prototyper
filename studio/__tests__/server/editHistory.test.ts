import { describe, it, expect, beforeEach } from "vitest";
import { pushSnapshot, popSnapshot, hasSnapshot, clearHistory } from "../../server/editHistory";
import {
  cachePreTurnSources,
  getPreTurnSource,
  clearPreTurnSources,
} from "../../server/editHistory";

describe("editHistory LIFO", () => {
  beforeEach(() => clearHistory("p", "f"));
  it("pops snapshots most-recent-first", () => {
    pushSnapshot("p", "f", "v1");
    pushSnapshot("p", "f", "v2");
    expect(popSnapshot("p", "f")).toBe("v2");
    expect(popSnapshot("p", "f")).toBe("v1");
    expect(popSnapshot("p", "f")).toBeNull();
  });
  it("isolates per slug::frameSlug", () => {
    pushSnapshot("p", "f", "A");
    pushSnapshot("p", "g", "B");
    expect(popSnapshot("p", "g")).toBe("B");
    expect(popSnapshot("p", "f")).toBe("A");
  });
  it("hasSnapshot reflects the stack", () => {
    expect(hasSnapshot("p", "f")).toBe(false);
    pushSnapshot("p", "f", "x");
    expect(hasSnapshot("p", "f")).toBe(true);
    popSnapshot("p", "f");
    expect(hasSnapshot("p", "f")).toBe(false);
  });
});

describe("pre-turn source cache (render-verify before-sources)", () => {
  it("stores + retrieves a page source by rel path", () => {
    cachePreTurnSources("proj", "01-frame", {
      "pages/Preferences.tsx": "BEFORE_A",
      "pages/Skills.tsx": "BEFORE_B",
    });
    expect(getPreTurnSource("proj", "01-frame", "pages/Preferences.tsx")).toBe("BEFORE_A");
    expect(getPreTurnSource("proj", "01-frame", "pages/Skills.tsx")).toBe("BEFORE_B");
  });
  it("returns null for an uncached path/frame", () => {
    expect(getPreTurnSource("proj", "01-frame", "pages/Nope.tsx")).toBeNull();
    expect(getPreTurnSource("proj", "other", "pages/Preferences.tsx")).toBeNull();
  });
  it("overwrites on a new turn (one slot per slug+frame, not a stack)", () => {
    cachePreTurnSources("p2", "f", { "index.tsx": "v1" });
    cachePreTurnSources("p2", "f", { "index.tsx": "v2" });
    expect(getPreTurnSource("p2", "f", "index.tsx")).toBe("v2");
  });
  it("clears", () => {
    cachePreTurnSources("p3", "f", { "index.tsx": "x" });
    clearPreTurnSources("p3", "f");
    expect(getPreTurnSource("p3", "f", "index.tsx")).toBeNull();
  });
});
