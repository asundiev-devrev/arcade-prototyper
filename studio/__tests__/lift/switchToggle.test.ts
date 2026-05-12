// studio/__tests__/lift/switchToggle.test.ts
//
// Regression guards for the Switch → Toggle mapping added 2026-05-12.
// Two fresh-agent lifts of 02-skill-modal (v2 and v3) independently
// re-derived this mapping via default_mapping_convention, so this file
// locks in what the one-shot lift should see without having to re-derive.

import { describe, it, expect } from "vitest";
import { buildManifest } from "../../src/lift/buildManifest";
import { renderXml } from "../../src/lift/render";
import { PRIMITIVE_MAPPINGS } from "../../src/lift/mappings/primitives";

const FRAME = `import { Switch } from "arcade/components";
export default function F() {
  return <Switch defaultChecked onCheckedChange={() => {}} />;
}`;

describe("Switch → Toggle mapping data", () => {
  const entry = PRIMITIVE_MAPPINGS.find(
    (m) => m.studio.source === "arcade" && m.studio.name === "Switch",
  );

  it("exists — live-lift runs should not have to re-derive the mapping", () => {
    expect(entry).toBeDefined();
  });

  it("targets production Toggle, not LinkButton / Checkbox / etc.", () => {
    expect(entry?.production.name).toBe("Toggle");
    expect(entry?.production.source).toBe("@devrev-web/design-system/shared/raw-design-system");
  });

  it("renames defaultChecked → initialChecked (verified against toggle.types.tsx)", () => {
    const delta = entry?.propDeltas?.find((d) => d.from === "defaultChecked");
    expect(delta?.to).toBe("initialChecked");
  });

  it("renames onCheckedChange → onChange and flags the value-based signature", () => {
    const delta = entry?.propDeltas?.find((d) => d.from === "onCheckedChange");
    expect(delta?.to).toBe("onChange");
    expect(delta?.note ?? "").toMatch(/boolean/i);
  });

  it("drops `label` explicitly (prop has no production equivalent)", () => {
    const dropped = entry?.droppedStudioProps?.map((d) => d.prop) ?? [];
    expect(dropped).toContain("label");
  });

  it("drops `size` explicitly (production Toggle has no size variant)", () => {
    const dropped = entry?.droppedStudioProps?.map((d) => d.prop) ?? [];
    expect(dropped).toContain("size");
  });

  it("points at real Toggle prior art under libs/", () => {
    const paths = (entry?.priorArt ?? []).map((p) => p.path);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.startsWith("libs/")).toBe(true);
    }
  });
});

describe("Switch → Toggle mapping rendering", () => {
  it("Switch in frame source produces a <mapping> block naming Toggle", () => {
    const rendered = renderXml(
      buildManifest({
        projectSlug: "p",
        frameSlug: "f",
        frameAbsPath: "/f",
        frameSource: FRAME,
        intentSummary: "",
      }),
    );
    expect(rendered).toContain(`name="Switch"`);
    expect(rendered).toContain(`name="Toggle"`);
  });

  it("renders the defaultChecked → initialChecked delta", () => {
    const rendered = renderXml(
      buildManifest({
        projectSlug: "p",
        frameSlug: "f",
        frameAbsPath: "/f",
        frameSource: FRAME,
        intentSummary: "",
      }),
    );
    expect(rendered).toMatch(/defaultChecked/);
    expect(rendered).toMatch(/initialChecked/);
  });

  it("renders the dropped `label` prop with a reason", () => {
    const rendered = renderXml(
      buildManifest({
        projectSlug: "p",
        frameSlug: "f",
        frameAbsPath: "/f",
        frameSource: FRAME,
        intentSummary: "",
      }),
    );
    // <dropped_props><prop name="label">…reason…</prop>…</dropped_props>
    expect(rendered).toMatch(/<prop name="label">/);
  });
});
