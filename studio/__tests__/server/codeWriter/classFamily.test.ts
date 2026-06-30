import { describe, it, expect } from "vitest";
import { applyClass, familyRegexFor, hasSpacingShorthand } from "../../../server/codeWriter/classFamily";

describe("applyClass", () => {
  it("swaps within the per-side padding family", () => {
    expect(applyClass("pt-4 text-sm", "pt-6")).toBe("text-sm pt-6");
  });
  it("swaps a token color family", () => {
    expect(applyClass("text-(--fg-default) font-bold", "text-(--fg-muted)"))
      .toBe("font-bold text-(--fg-muted)");
  });
  it("swaps a type-style token", () => {
    expect(applyClass("text-body-md p-4", "text-title-sm")).toBe("p-4 text-title-sm");
  });
  it("adds when the family is absent", () => {
    expect(applyClass("flex gap-2", "rounded-md")).toBe("flex gap-2 rounded-md");
  });
  it("collapses whitespace and avoids duplicates", () => {
    expect(applyClass("  pt-6   text-sm ", "pt-6")).toBe("text-sm pt-6");
  });
});

describe("familyRegexFor", () => {
  it("knows the families it supports", () => {
    expect(familyRegexFor("pt-6")!.test("pt-4")).toBe(true);
    expect(familyRegexFor("pt-6")!.test("pb-4")).toBe(false);
    expect(familyRegexFor("font-semibold")!.test("font-bold")).toBe(true);
    expect(familyRegexFor("text-(--fg-muted)")!.test("text-(--fg-default)")).toBe(true);
    expect(familyRegexFor("text-(--fg-muted)")!.test("text-center")).toBe(false);
    expect(familyRegexFor("text-center")!.test("text-left")).toBe(true);
    expect(familyRegexFor("text-title-sm")!.test("text-body-md")).toBe(true);
  });
  it("returns null for an unknown class shape", () => {
    expect(familyRegexFor("totally-unknown-xyz")).toBeNull();
  });
});

describe("hasSpacingShorthand", () => {
  it("flags p-/px- conflicts with a per-side padding edit", () => {
    expect(hasSpacingShorthand("p-4 flex", "pt-6")).toBe(true);
    expect(hasSpacingShorthand("px-4 flex", "pt-6")).toBe(true);
    expect(hasSpacingShorthand("py-4 flex", "pt-6")).toBe(true);
  });
  it("does not flag when only per-side classes exist", () => {
    expect(hasSpacingShorthand("pt-4 pb-2", "pt-6")).toBe(false);
  });
  it("ignores non-spacing targets", () => {
    expect(hasSpacingShorthand("p-4", "font-bold")).toBe(false);
  });
});
