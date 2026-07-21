import { describe, it, expect } from "vitest";
import { renderManifestMarkdown, renderManifestIndex, PRIMITIVE_CAPABILITIES } from "../../server/kitManifest";

describe("PRIMITIVE_CAPABILITIES manifest section", () => {
  it("renders a Primitive capabilities section", () => {
    const md = renderManifestMarkdown([]);
    expect(md).toContain("## Primitive capabilities");
  });
  it("states Select is single-value with no multiple prop (the repro)", () => {
    const md = renderManifestMarkdown([]);
    expect(md).toMatch(/Select[\s\S]*no `?multiple`?/i);
    expect(md).toMatch(/Select[\s\S]*string/i);
  });
  it("states ToggleGroup DOES support multi-select via type='multiple' (NOT 'no multi-select')", () => {
    const md = renderManifestMarkdown([]);
    expect(md).toMatch(/ToggleGroup[\s\S]*type="?multiple"?/i);
    expect(md).not.toMatch(/ToggleGroup has no multi-select/i);
  });
  it("PRIMITIVE_CAPABILITIES covers the misused primitives", () => {
    for (const c of ["Select", "ToggleGroup", "Tabs"]) expect(PRIMITIVE_CAPABILITIES[c]).toBeTruthy();
  });
  it("covers Accordion (the other type-union component the hook policies) with the type-gated rule", () => {
    // The hook (validateComponentProps) treats Accordion the SAME as ToggleGroup.
    // If the hook can block an Accordion prop, the agent must be taught its shape
    // upfront — else it only discovers the rule via a block. A↔C consistency.
    expect(PRIMITIVE_CAPABILITIES.Accordion).toBeTruthy();
    expect(PRIMITIVE_CAPABILITIES.Accordion).toMatch(/type="?multiple"?/i);
    expect(PRIMITIVE_CAPABILITIES.Accordion).not.toMatch(/no multi-select/i);
  });
  it("the slim index carries the capabilities section too (both renderers agree)", () => {
    const idx = renderManifestIndex([]);
    expect(idx).toContain("## Primitive capabilities");
  });
});
