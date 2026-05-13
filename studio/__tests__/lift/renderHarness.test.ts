// studio/__tests__/lift/renderHarness.test.ts
//
// Guards for the render_harness block added 2026-05-13. The harness is
// always emitted; conditional checks adapt to which conventions fired.

import { describe, it, expect } from "vitest";
import { buildManifest } from "../../src/lift/buildManifest";
import { renderXml } from "../../src/lift/render";
import { buildRenderHarness } from "../../src/lift/renderHarness";

function mk(src: string, slug = "f") {
  return buildManifest({
    projectSlug: "p",
    frameSlug: slug,
    frameAbsPath: "/f",
    frameSource: src,
    intentSummary: "",
  });
}

describe("buildRenderHarness", () => {
  it("always includes baseline checks (console clean, real border color, non-transparent backgrounds)", () => {
    const harness = buildRenderHarness(mk(`export default () => null;`));
    const joined = harness.checks.join("\n");
    expect(joined).toMatch(/console errors/i);
    expect(joined).toMatch(/borderColor/);
    expect(joined).toMatch(/backgroundColor/);
  });

  it("adds an inline-style-token check when hasInlineStyleTokens fires", () => {
    const harness = buildRenderHarness(
      mk(`<div style={{ color: 'var(--fg-neutral-subtle)' }}/>`),
    );
    const joined = harness.checks.join("\n");
    expect(joined).toMatch(/style_attribute_convention/i);
  });

  it("adds an overlay check when hasOverlay fires", () => {
    const harness = buildRenderHarness(
      mk(`<div className="fixed inset-0 bg-black/50"/>`),
    );
    const joined = harness.checks.join("\n");
    expect(joined).toMatch(/fixed inset-0/i);
  });

  it("adds an icon-consumption check when icon imports are present", () => {
    const harness = buildRenderHarness(
      mk(`import { MagnifyingGlass } from "arcade/components";`),
    );
    const joined = harness.checks.join("\n");
    expect(joined).toMatch(/ICON_TYPES/);
  });

  it("adds a close-but-not-identity check naming the affected components", () => {
    const harness = buildRenderHarness(
      mk(`import { Tabs } from "arcade/components";`),
    );
    const joined = harness.checks.join("\n");
    expect(joined).toMatch(/close-but-not-identity/);
    expect(joined).toMatch(/Tabs/);
  });

  it("derives targetPath from the frameSlug", () => {
    const harness = buildRenderHarness(mk(`export default () => null;`, "my-slug"));
    expect(harness.targetPath).toContain("my-slug.tsx");
  });

  it("backdrop note prescribes a non-white background to expose near-white borders", () => {
    const harness = buildRenderHarness(mk(`export default () => null;`));
    expect(harness.backdropNote).toMatch(/backdrop|background/i);
    expect(harness.backdropNote).toMatch(/hsl\(var\(--/);
  });
});

describe("render_harness XML emission", () => {
  it("emits a <render_harness> block on every manifest", () => {
    const xml = renderXml(mk(`export default () => null;`));
    expect(xml).toContain("<render_harness>");
    expect(xml).toContain("<target_path>");
    expect(xml).toContain("<iframe_url>");
    expect(xml).toContain("<backdrop_note>");
    expect(xml).toContain("<checks>");
    expect(xml).toContain("<check>");
  });
});
