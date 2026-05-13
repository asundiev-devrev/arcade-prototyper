// studio/__tests__/lift/closeButNotIdentity.test.ts
//
// Guards for the TranslationClass added 2026-05-13. Tabs was the first
// entry reclassified; this file locks that in + asserts the metric
// bucket counts correctly without inflating decisionPoints.

import { describe, it, expect } from "vitest";
import { buildManifest } from "../../src/lift/buildManifest";
import { computeMetrics } from "../../src/lift/metrics";
import { PRIMITIVE_MAPPINGS } from "../../src/lift/mappings/primitives";
import { renderXml } from "../../src/lift/render";

describe("close-but-not-identity translation class", () => {
  it("Tabs is classified as close-but-not-identity (not mechanical, not structural)", () => {
    const tabs = PRIMITIVE_MAPPINGS.find(
      (m) => m.studio.source === "arcade" && m.studio.name === "Tabs",
    );
    expect(tabs?.translationClass).toBe("close-but-not-identity");
  });

  it("a frame that imports Tabs gets closeButNotIdentity=1 without touching decisionPoints", () => {
    const m = buildManifest({
      projectSlug: "p",
      frameSlug: "f",
      frameAbsPath: "/f",
      frameSource: `import { Tabs } from "arcade/components";`,
      intentSummary: "",
    });
    const metrics = computeMetrics(m);
    expect(metrics.closeButNotIdentity).toBe(1);
    // Close-but-not-identity is not a reviewer decision — the convention
    // tells the agent exactly how to wrap. Should not inflate the gate.
    expect(metrics.decisionPoints).toBe(0);
  });

  it("renders class=\"close-but-not-identity\" in the XML", () => {
    const m = buildManifest({
      projectSlug: "p",
      frameSlug: "f",
      frameAbsPath: "/f",
      frameSource: `import { Tabs } from "arcade/components";`,
      intentSummary: "",
    });
    // (renderXml imported at the top of the file.)
    const xml: string = renderXml(m);
    expect(xml).toContain('class="close-but-not-identity"');
  });
});

describe("agent_directives coverage for close-but-not-identity", () => {
  it("the agent directive explicitly tells the agent to treat per-delta notes as load-bearing", () => {
    const xml: string = renderXml(
      buildManifest({
        projectSlug: "p",
        frameSlug: "f",
        frameAbsPath: "/f",
        frameSource: `export default () => null;`,
        intentSummary: "",
      }),
    );
    expect(xml).toMatch(/CLOSE-BUT-NOT-IDENTITY/);
    expect(xml).toMatch(/load-bearing/i);
  });
});
