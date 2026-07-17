import { describe, it, expect } from "vitest";
import { renderManifestMarkdown, PRIMITIVE_CAPABILITIES } from "../../server/kitManifest";

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
});
