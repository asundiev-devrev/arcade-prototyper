import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import { TEMPLATES, getTemplate, readTemplateSeed, TEMPLATE_SEEDS_DIR } from "../../server/templates";

describe("templates manifest", () => {
  it("exposes exactly the named templates", () => {
    expect(TEMPLATES.map((t) => t.id).sort()).toEqual(["builder-page", "computer", "computer-settings"]);
  });

  it("every entry has a name, description, and a seed (file or directory) on disk", async () => {
    const fsmod = await import("node:fs/promises");
    const { templateSeedPath } = await import("../../server/templates");
    for (const t of TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      const st = await fsmod.stat(templateSeedPath(t.id));
      if (st.isDirectory()) {
        const idx = await fsmod.readFile(`${templateSeedPath(t.id)}/index.tsx`, "utf-8");
        expect(idx).toContain("export default");
      } else {
        const src = await fsmod.readFile(templateSeedPath(t.id), "utf-8");
        expect(src).toContain("export default");
      }
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
