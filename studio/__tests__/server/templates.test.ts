import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import { TEMPLATES, getTemplate, readTemplateSeed, TEMPLATE_SEEDS_DIR } from "../../server/templates";

describe("templates manifest", () => {
  it("exposes exactly the three named templates", () => {
    expect(TEMPLATES.map((t) => t.id).sort()).toEqual(["app-list", "computer", "settings-page"]);
  });

  it("every entry has a name, description, and a seed file that exists on disk", async () => {
    for (const t of TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      const src = await fs.readFile(`${TEMPLATE_SEEDS_DIR}/${t.id}.tsx`, "utf-8");
      expect(src).toContain("export default");
    }
  });

  it("getTemplate returns undefined for an unknown id", () => {
    expect(getTemplate("nope")).toBeUndefined();
    expect(getTemplate("computer")?.id).toBe("computer");
  });

  it("readTemplateSeed returns the on-disk source", async () => {
    const src = await readTemplateSeed("computer");
    expect(src).toContain("ComputerScene");
  });
});
