import { describe, it, expect, vi } from "vitest";
import { buildBindEdit } from "../../src/lib/visualEditClient";

describe("buildBindEdit payload", () => {
  it("builds a bindPath edit carrying the new text", () => {
    const p = buildBindEdit("transcript[id=2].text", "Hello", "01-computer");
    expect(p.frameSlug).toBe("01-computer");
    expect(p.edits[0].bindPath).toBe("transcript[id=2].text");
    expect(p.edits[0].text).toBe("Hello");
    expect(p.edits[0].fields).toEqual([]);
  });
});
