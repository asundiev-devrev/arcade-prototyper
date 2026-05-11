import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, "../../templates/CLAUDE.md.tpl");

describe("CLAUDE.md template — design system section", () => {
  it("contains the `## Design system` heading", () => {
    const tpl = fs.readFileSync(TEMPLATE, "utf-8");
    expect(tpl).toMatch(/^## Design system$/m);
  });

  it("contains the literal `@DESIGN.md` import line", () => {
    const tpl = fs.readFileSync(TEMPLATE, "utf-8");
    expect(tpl).toMatch(/^@DESIGN\.md$/m);
  });

  it("places the Design system section before the four-rules section", () => {
    const tpl = fs.readFileSync(TEMPLATE, "utf-8");
    const designIdx = tpl.indexOf("## Design system");
    const rulesIdx = tpl.indexOf("R1. Figma is the source of truth");
    expect(designIdx).toBeGreaterThan(-1);
    expect(rulesIdx).toBeGreaterThan(-1);
    expect(designIdx).toBeLessThan(rulesIdx);
  });
});
