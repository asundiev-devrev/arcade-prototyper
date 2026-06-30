import { describe, it, expect } from "vitest";
import { moveSiblingInSource } from "../../../server/codeWriter/reorder";

const SRC = `export default function F() {
  return (
    <div>
      <span>A</span>
      <span>B</span>
      <span>C</span>
    </div>
  );
}
`;

describe("moveSiblingInSource", () => {
  it("moves B up (swaps with A)", () => {
    // line 5 == the second <span> (B)
    const r = moveSiblingInSource(SRC, 5, 8, "up") as any;
    expect(r.ok).toBe(true);
    const order = [...r.source.matchAll(/<span>([ABC])<\/span>/g)].map((m: any) => m[1]);
    expect(order).toEqual(["B", "A", "C"]);
  });
  it("moves A down (swaps with B)", () => {
    const r = moveSiblingInSource(SRC, 4, 8, "down") as any;
    expect(r.ok).toBe(true);
    const order = [...r.source.matchAll(/<span>([ABC])<\/span>/g)].map((m: any) => m[1]);
    expect(order).toEqual(["B", "A", "C"]);
  });
  it("bails at the top boundary", () => {
    const r = moveSiblingInSource(SRC, 4, 8, "up") as any;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no-sibling");
  });

  it("disambiguates siblings on the same line by nearest column", () => {
    // Two spans on the SAME line, plus a third on a separate line.
    const src = `export default function F() {
  return (
    <div>
      <span>A</span><span>B</span>
      <span>C</span>
    </div>
  );
}
`;
    // Target the second span's tag position (line 4, col ~20, nearer to B than A).
    // A starts at col 6, B starts at col ~20.
    const r = moveSiblingInSource(src, 4, 20, "up") as any;
    expect(r.ok).toBe(true);
    const order = [...r.source.matchAll(/<span>([ABC])<\/span>/g)].map((m: any) => m[1]);
    expect(order).toEqual(["B", "A", "C"]);
  });
});
