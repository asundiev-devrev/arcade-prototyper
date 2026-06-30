import { describe, it, expect } from "vitest";
import { applyClass, familyRegexFor } from "../../../server/codeWriter/classFamily";

describe("sizing families", () => {
  it("recognizes width/height families incl. arbitrary values", () => {
    expect(familyRegexFor("w-[300px]")!.test("w-64")).toBe(true);
    expect(familyRegexFor("w-[300px]")!.test("w-[200px]")).toBe(true);
    expect(familyRegexFor("w-[300px]")!.test("h-10")).toBe(false);
    expect(familyRegexFor("h-[48px]")!.test("h-12")).toBe(true);
    expect(familyRegexFor("min-w-[120px]")!.test("min-w-0")).toBe(true);
    expect(familyRegexFor("max-w-[640px]")!.test("max-w-full")).toBe(true);
  });
  it("recognizes the font-size family (text-[..] vs scale)", () => {
    expect(familyRegexFor("text-[15px]")!.test("text-sm")).toBe(true);
    expect(familyRegexFor("text-[15px]")!.test("text-[20px]")).toBe(true);
    // must NOT collide with token color text-(--..) or align text-center or type text-body
    expect(familyRegexFor("text-[15px]")!.test("text-(--fg-muted)")).toBe(false);
    expect(familyRegexFor("text-[15px]")!.test("text-center")).toBe(false);
    expect(familyRegexFor("text-[15px]")!.test("text-body-md")).toBe(false);
  });
  it("swaps an arbitrary width over an existing one", () => {
    expect(applyClass("flex w-64", "w-[300px]")).toBe("flex w-[300px]");
    expect(applyClass("w-[200px] gap-2", "w-[300px]")).toBe("gap-2 w-[300px]");
  });
  it("swaps an arbitrary spacing over a scale step", () => {
    expect(applyClass("pt-4 text-sm", "pt-[18px]")).toBe("text-sm pt-[18px]");
  });
});
