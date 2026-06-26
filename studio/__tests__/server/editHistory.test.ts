import { describe, it, expect, beforeEach } from "vitest";
import { pushSnapshot, popSnapshot, hasSnapshot, clearHistory } from "../../server/editHistory";

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
