import { describe, it, expect } from "vitest";
import { spliceComponentInSource } from "../../../server/customize/spliceComponent";

const SRC = `import { ComputerScene } from "arcade-prototypes";
export default function F() {
  return (
    <ComputerScene />
  );
}
`;

describe("spliceComponentInSource", () => {
  it("replaces the self-closing component element with the new jsx", () => {
    // <ComputerScene /> is on line 4; column of the tag name ~6
    const r = spliceComponentInSource(SRC, "ComputerScene", 4, 6, `<div className="flex">hi</div>`) as any;
    expect(r.ok).toBe(true);
    expect(r.source).toContain(`<div className="flex">hi</div>`);
    expect(r.source).not.toContain(`<ComputerScene />`);
  });
  it("bails when the replacement would not parse", () => {
    const r = spliceComponentInSource(SRC, "ComputerScene", 4, 6, `<div>`) as any; // unbalanced
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("reparse-failed");
  });
  it("bails when the target isn't found", () => {
    const r = spliceComponentInSource(SRC, "Nope", 4, 6, `<div/>`) as any;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("target-not-found");
  });
});
