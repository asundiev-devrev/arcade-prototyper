// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseComponentFile } from "../../server/middleware/components";

describe("parseComponentFile", () => {
  it("reads the arcade-component header", () => {
    const text = `// @arcade-component name="PriceTag" description="A price tag"\nexport function PriceTag(){return null}`;
    const r = parseComponentFile(text);
    expect(r.name).toBe("PriceTag");
    expect(r.description).toBe("A price tag");
    expect(r.tsx).toContain("export function PriceTag");
    expect(r.tsx).not.toContain("@arcade-component");
  });
  it("falls back to the first exported component when no header", () => {
    const text = `export function FancyBox(){return null}`;
    const r = parseComponentFile(text);
    expect(r.name).toBe("FancyBox");
    expect(r.description).toBe("");
  });
});
