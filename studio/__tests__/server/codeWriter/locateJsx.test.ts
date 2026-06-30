// studio/__tests__/server/codeWriter/locateJsx.test.ts
import { describe, it, expect } from "vitest";
import { locateJsx } from "../../../server/codeWriter/locateJsx";

const SRC = `export default function F() {
  return (
    <div className="p-4">
      <span className="text-sm">Hi</span>
    </div>
  );
}
`;

describe("locateJsx", () => {
  it("finds the outer div at its tag position", () => {
    // line 3, column 6 == the "div" identifier (1-based: "    <div" → '<' at col 5, 'd' at col 6)
    const hit = locateJsx(SRC, 3, 6);
    expect(hit?.tagName).toBe("div");
    expect(hit?.selfClosing).toBe(false);
    // Verify character offsets by slicing the source
    expect(SRC.slice(hit!.openingStart, hit!.openingEnd)).toBe('<div className="p-4">');
    expect(SRC.slice(hit!.elementStart, hit!.elementEnd)).toMatch(/^<div[\s\S]*<\/div>$/);
    expect(SRC.slice(hit!.elementStart, hit!.elementEnd)).toContain('<span className="text-sm">Hi</span>');
  });
  it("finds the inner span on its own line", () => {
    const hit = locateJsx(SRC, 4, 8);
    expect(hit?.tagName).toBe("span");
    // Verify character offsets
    expect(SRC.slice(hit!.openingStart, hit!.openingEnd)).toBe('<span className="text-sm">');
    expect(SRC.slice(hit!.elementStart, hit!.elementEnd)).toBe('<span className="text-sm">Hi</span>');
  });
  it("returns null when no JSX is on the line", () => {
    expect(locateJsx(SRC, 1, 1)).toBeNull();
  });
  it("handles a self-closing element", () => {
    const src2 = `const x = <img src="a.png" />;\n`;
    const hit = locateJsx(src2, 1, 12);
    expect(hit?.tagName).toBe("img");
    expect(hit?.selfClosing).toBe(true);
    // Verify character offsets for self-closing element
    expect(src2.slice(hit!.openingStart, hit!.openingEnd)).toBe('<img src="a.png" />');
    expect(src2.slice(hit!.elementStart, hit!.elementEnd)).toBe('<img src="a.png" />');
    // For self-closing elements, elementEnd should equal openingEnd
    expect(hit!.elementEnd).toBe(hit!.openingEnd);
  });
});
