import { describe, it, expect } from "vitest";
import { translateField } from "../../../server/codeWriter/pxScale";

describe("translateField arbitrary values", () => {
  it("snaps spacing to a scale step when exact", () => {
    expect(translateField("paddingTop", "24px")).toBe("pt-6");
  });
  it("emits an arbitrary spacing value when off-scale", () => {
    expect(translateField("paddingTop", "18px")).toBe("pt-[18px]");
    expect(translateField("gap", "7px")).toBe("gap-[7px]");
  });
  it("emits width/height as arbitrary values (no longer bails)", () => {
    expect(translateField("width", "300px")).toBe("w-[300px]");
    expect(translateField("height", "48px")).toBe("h-[48px]");
    expect(translateField("minWidth", "120px")).toBe("min-w-[120px]");
    expect(translateField("maxWidth", "640px")).toBe("max-w-[640px]");
    expect(translateField("minHeight", "40px")).toBe("min-h-[40px]");
    expect(translateField("maxHeight", "80px")).toBe("max-h-[80px]");
  });
  it("emits font size as arbitrary value", () => {
    expect(translateField("fontSize", "15px")).toBe("text-[15px]");
  });
  it("emits opacity arbitrary when off the /5 step", () => {
    expect(translateField("opacity", "0.5")).toBe("opacity-50");   // on step
    expect(translateField("opacity", "0.37")).toBe("opacity-[0.37]"); // off step
  });
  it("snaps radius to scale or emits arbitrary", () => {
    expect(translateField("borderRadius", "6px")).toBe("rounded-md");
    expect(translateField("borderRadius", "5px")).toBe("rounded-[5px]");
  });
  it("still bails (null) for non-px junk on a numeric field", () => {
    expect(translateField("width", "auto")).toBeNull();
    expect(translateField("paddingTop", "")).toBeNull();
  });
  it("keeps enum fields as-is (display/flexDirection not numeric)", () => {
    // display/flexDirection are written as raw enum classes elsewhere; translateField
    // returns null for them so the caller routes them through its enum path.
    expect(translateField("display", "flex")).toBeNull();
  });
});
