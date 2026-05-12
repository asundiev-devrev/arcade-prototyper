// studio/__tests__/lift/tabsOnValueChange.test.ts
//
// Regression guard for the Tabs mapping correction made 2026-05-12.
// First real typecheck of v3 lifted skills-gallery against devrev-web
// surfaced TS2322 on `<Tabs value={activeTab} onValueChange={setActiveTab}>`:
// production Tabs.onValueChange signature is `(value?: string) => void`,
// so a bare useState<string> setter won't accept the optional undefined.
//
// The mapping entry must carry this guidance so the downstream agent
// wraps the callback (e.g. `(v) => setActiveTab(v ?? "")`).

import { describe, it, expect } from "vitest";
import { buildManifest } from "../../src/lift/buildManifest";
import { renderXml } from "../../src/lift/render";
import { PRIMITIVE_MAPPINGS } from "../../src/lift/mappings/primitives";

describe("Tabs onValueChange optional-arg guidance", () => {
  const entry = PRIMITIVE_MAPPINGS.find(
    (m) => m.studio.source === "arcade" && m.studio.name === "Tabs",
  );

  it("onChange → onValueChange delta carries the optional-arg warning", () => {
    const delta = entry?.propDeltas?.find((d) => d.from === "onChange");
    expect(delta?.to).toBe("onValueChange");
    // The agent needs to see that the callback's arg is `string | undefined`,
    // not `string` — otherwise it writes a bare useState setter and hits
    // TS2322 at type-check time.
    expect(delta?.note ?? "").toMatch(/string \| undefined|\(value\?: string\)/);
    expect(delta?.note ?? "").toMatch(/wrap/i);
  });

  it("slot notes call out the bare-setState trap", () => {
    const joined = (entry?.slotNotes ?? []).join("\n");
    expect(joined).toMatch(/bare\s*setState|typecheck/i);
  });

  it("renders the guidance into the XML manifest so downstream sees it", () => {
    const rendered = renderXml(
      buildManifest({
        projectSlug: "p",
        frameSlug: "f",
        frameAbsPath: "/f",
        frameSource: `import { Tabs } from "arcade/components";
export default function F() {
  return <Tabs value="a" onChange={() => {}} />;
}`,
        intentSummary: "",
      }),
    );
    // prop-delta with guidance text survives XML escaping (&gt; for >, etc.)
    expect(rendered).toContain(`from="onChange"`);
    expect(rendered).toMatch(/value\?: string/);
  });
});
