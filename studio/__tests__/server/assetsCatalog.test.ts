import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCompositeSection, buildIconSection } from "../../server/assetsCatalog";

const KIT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "prototype-kit",
);

describe("buildCompositeSection", () => {
  it("returns every composite + template as catalog items", async () => {
    const section = await buildCompositeSection(KIT_ROOT);
    expect(section.kind).toBe("composite");
    // 30 composites + 4 templates = 34 (see spec census).
    expect(section.items.length).toBeGreaterThanOrEqual(34);
    const items = section.items as { name: string; doc: string; thumb: string }[];
    const formModal = items.find((i) => i.name === "FormModal");
    expect(formModal).toBeDefined();
    expect(formModal!.doc.length).toBeGreaterThan(0);
    expect(formModal!.thumb).toBe("assets-thumbs/FormModal.png");
    // No prop dumps — designers don't need them.
    expect(formModal).not.toHaveProperty("propsSource");
  });
});

describe("buildIconSection", () => {
  it("returns icons with name + standalone inline svg + tags", async () => {
    const section = await buildIconSection();
    expect(section.kind).toBe("icon");
    expect(section.items.length).toBeGreaterThanOrEqual(120);
    const first = section.items[0] as { name: string; svg: string; tags: string[] };
    expect(first.name).toMatch(/^[A-Z]/); // PascalCase component name
    // svgContent is inner markup; builder must wrap it in a real <svg> element.
    expect(first.svg).toContain("<svg");
    expect(first.svg).toContain("</svg>");
    expect(Array.isArray(first.tags)).toBe(true);
  });
});
