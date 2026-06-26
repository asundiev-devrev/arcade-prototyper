import { describe, it, expect } from "vitest";
import { markJsxRoot, newCustomizeToken } from "../../src/lib/customizeClient";

describe("markJsxRoot", () => {
  it("adds the marker attr to a host-element root", () => {
    const out = markJsxRoot(`<div className="flex">x</div>`, "cz-abc123");
    expect(out).toBe(`<div data-arcade-customized="cz-abc123" className="flex">x</div>`);
  });
  it("adds the marker attr to a component root", () => {
    const out = markJsxRoot(`<Card variant="x"><b>y</b></Card>`, "cz-zzz999");
    expect(out).toBe(`<Card data-arcade-customized="cz-zzz999" variant="x"><b>y</b></Card>`);
  });
  it("handles a self-closing root", () => {
    const out = markJsxRoot(`<Icon name="Trash" />`, "cz-1");
    expect(out).toBe(`<Icon data-arcade-customized="cz-1" name="Trash" />`);
  });
  it("returns input unchanged when no root tag is found", () => {
    expect(markJsxRoot(`not jsx`, "cz-1")).toBe(`not jsx`);
  });
  it("ignores leading whitespace before the root", () => {
    expect(markJsxRoot(`  <span>z</span>`, "cz-2")).toBe(`  <span data-arcade-customized="cz-2">z</span>`);
  });
});

describe("newCustomizeToken", () => {
  it("produces a cz- prefixed token", () => {
    expect(newCustomizeToken()).toMatch(/^cz-[a-z0-9]+$/);
  });
  it("produces distinct tokens", () => {
    expect(newCustomizeToken()).not.toBe(newCustomizeToken());
  });
});
