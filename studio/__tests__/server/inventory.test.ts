// @vitest-environment node
import { describe, it, expect } from "vitest";
import { renderInventory, INVENTORY_CHAR_CAP } from "../../server/inventory";

const FRAME_A = `
import { VistaPage, Checkbox } from "arcade";
export default function Page() {
  return <VistaPage title="All tickets"><Checkbox /></VistaPage>;
}
`;

describe("renderInventory", () => {
  it("lists each frame with the composites it uses", () => {
    const out = renderInventory({
      frames: [{ slug: "01-knowledge-list", source: FRAME_A }],
      components: [],
    });
    expect(out).toContain("01-knowledge-list");
    expect(out).toContain("VistaPage");
    expect(out).toContain("Checkbox");
  });

  it("lists the designer's saved composites by name", () => {
    const out = renderInventory({ frames: [], components: ["SkillCardAndrey"] });
    expect(out).toContain("SkillCardAndrey");
  });

  it("says so explicitly when the project is empty", () => {
    const out = renderInventory({ frames: [], components: [] });
    expect(out).toMatch(/no frames yet/i);
  });

  it("does not claim saved composites when there are none", () => {
    const out = renderInventory({
      frames: [{ slug: "01-a", source: FRAME_A }],
      components: [],
    });
    expect(out).not.toMatch(/saved composites/i);
  });

  it("caps total length so a huge project cannot blow the prompt budget", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      slug: `frame-${i}`,
      source: FRAME_A,
    }));
    const out = renderInventory({ frames: many, components: [] });
    expect(out.length).toBeLessThanOrEqual(INVENTORY_CHAR_CAP);
    expect(out).toMatch(/more frames not listed/i);
  });

  it("is deterministic — same input, same output", () => {
    const args = { frames: [{ slug: "01-a", source: FRAME_A }], components: ["X"] };
    expect(renderInventory(args)).toBe(renderInventory(args));
  });
});
