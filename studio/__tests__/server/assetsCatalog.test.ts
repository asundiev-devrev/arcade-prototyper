import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCompositeSection,
  buildIconSection,
  buildComponentSection,
} from "../../server/assetsCatalog";

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

describe("buildComponentSection", () => {
  it("returns curated arcade-gen components with docs + thumb paths", () => {
    const section = buildComponentSection();
    expect(section.kind).toBe("component");
    expect(section.items.length).toBeGreaterThanOrEqual(30);
    const items = section.items as { name: string; doc: string; thumb: string }[];
    const button = items.find((i) => i.name === "Button");
    expect(button).toBeDefined();
    expect(button!.doc.length).toBeGreaterThan(0);
    expect(button!.thumb).toBe("assets-thumbs/Button.png");
    const names = items.map((i) => i.name);
    // Hooks/types/sub-parts must NOT appear.
    expect(names).not.toContain("useDevRevTheme");
    expect(names).not.toContain("buttonVariants");
    expect(names).not.toContain("HStack");
    // Charts are one compound component, not per-type exports.
    expect(names).not.toContain("LineChart");
  });
});
