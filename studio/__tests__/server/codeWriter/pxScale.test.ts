import { describe, it, expect } from "vitest";
import { pxToSpace, pxToRadius, translateField } from "../../../server/codeWriter/pxScale";

describe("pxToSpace", () => {
  it("maps exact grid steps", () => {
    expect(pxToSpace(0)).toBe("0");
    expect(pxToSpace(16)).toBe("4");
    expect(pxToSpace(24)).toBe("6");
    expect(pxToSpace(2)).toBe("0.5");
  });
  it("returns null for off-grid", () => {
    expect(pxToSpace(23)).toBeNull();
    expect(pxToSpace(17)).toBeNull();
  });
});

describe("pxToRadius", () => {
  it("maps the radius scale", () => {
    expect(pxToRadius(0)).toBe("none");
    expect(pxToRadius(4)).toBe("");      // bare `rounded`
    expect(pxToRadius(6)).toBe("md");
    expect(pxToRadius(9999)).toBe("full");
  });
  it("returns null off-scale", () => {
    expect(pxToRadius(5)).toBeNull();
  });
});

describe("translateField", () => {
  it("per-side padding/margin/gap", () => {
    expect(translateField("paddingTop", "24px")).toBe("pt-6");
    expect(translateField("marginLeft", "16px")).toBe("ml-4");
    expect(translateField("gap", "8px")).toBe("gap-2");
  });
  it("radius", () => {
    expect(translateField("borderRadius", "6px")).toBe("rounded-md");
    expect(translateField("borderRadius", "4px")).toBe("rounded");
  });
  it("font weight / align / style / opacity", () => {
    expect(translateField("fontWeight", "600")).toBe("font-semibold");
    expect(translateField("textAlign", "center")).toBe("text-center");
    expect(translateField("fontStyle", "italic")).toBe("italic");
    expect(translateField("fontStyle", "normal")).toBe("not-italic");
    expect(translateField("opacity", "0.5")).toBe("opacity-50");
  });
  it("bails (null) for unsupported fields & off-scale values", () => {
    expect(translateField("fontSize", "18px")).toBeNull();   // typography → AI
    expect(translateField("width", "247px")).toBeNull();     // sizing → AI in v1
    expect(translateField("paddingTop", "23px")).toBeNull(); // off-grid
    expect(translateField("opacity", "0.37")).toBeNull();    // not /5 step
  });
});
