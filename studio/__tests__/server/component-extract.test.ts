import { describe, it, expect } from "vitest";
import { buildExtractPrompt } from "../../server/componentExtract";

describe("buildExtractPrompt", () => {
  const p = buildExtractPrompt({ name: "PriceTag", description: "A price tag", frameSlug: "01-home", line: 42, column: 7 });
  it("anchors to the picked location", () => {
    expect(p).toContain("frames/01-home/index.tsx");
    expect(p).toContain("42:7");
  });
  it("names the output file and component", () => {
    expect(p).toContain("user-kit/composites/PriceTag.tsx");
    expect(p).toContain("PriceTag");
  });
  it("enforces house-style rules", () => {
    expect(p).toMatch(/arcade\/components/);
    expect(p).toMatch(/PriceTagProps/);
    expect(p).toMatch(/JSDoc|header comment/i);
  });
  it("carries the description for the JSDoc", () => {
    expect(p).toContain("A price tag");
  });
  it("requires both named and default export", () => {
    expect(p).toMatch(/export function PriceTag/);
    expect(p).toMatch(/export default PriceTag/);
  });
});
