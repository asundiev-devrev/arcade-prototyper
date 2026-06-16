import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCompositeSection } from "../../server/assetsCatalog";

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
    const formModal = section.items.find((i) => i.name === "FormModal");
    expect(formModal).toBeDefined();
    expect(formModal!.doc.length).toBeGreaterThan(0);
    expect(formModal!.thumb).toBe("assets-thumbs/FormModal.png");
    // No prop dumps — designers don't need them.
    expect(formModal).not.toHaveProperty("propsSource");
  });
});
