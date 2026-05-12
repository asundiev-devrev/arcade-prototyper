// studio/__tests__/lift/metrics.test.ts
//
// Unit tests for the decision-point metric. Verifies each bucket is
// counted once and that totals sum correctly. Fixture-gated PR behavior
// is tested separately in liftLoop.test.ts.

import { describe, it, expect } from "vitest";
import { buildManifest } from "../../src/lift/buildManifest";
import { computeMetrics } from "../../src/lift/metrics";

function m(src: string) {
  return buildManifest({
    projectSlug: "p",
    frameSlug: "f",
    frameAbsPath: "/f/index.tsx",
    frameSource: src,
    intentSummary: "",
  });
}

describe("computeMetrics", () => {
  it("zero decision points for a fully-mapped mechanical frame", () => {
    // Button, Tabs, Badge, Tooltip are all mechanical in primitives.ts.
    const metrics = computeMetrics(
      m(`import { Button, Tabs, Badge, Tooltip } from "arcade";`),
    );
    expect(metrics).toEqual({
      decisionPoints: 0,
      unmapped: 0,
      judgment: 0,
      naMappings: 0,
      needsReviewerProps: 0,
      iconsAbsorbed: 0,
    });
  });

  it("counts unmapped imports (non-icon)", () => {
    const metrics = computeMetrics(
      m(`import { TotallyMadeUp, AlsoNotReal } from "arcade";`),
    );
    expect(metrics.unmapped).toBe(2);
    expect(metrics.decisionPoints).toBe(2);
    expect(metrics.iconsAbsorbed).toBe(0);
  });

  it("absorbs icons via the icon convention — not counted as decision points", () => {
    const metrics = computeMetrics(
      m(
        `import { MagnifyingGlass, Bell, PlusSmall, ChevronRightSmall } from "arcade/components";`,
      ),
    );
    expect(metrics.unmapped).toBe(0);
    expect(metrics.iconsAbsorbed).toBe(4);
    expect(metrics.decisionPoints).toBe(0);
  });

  it("counts judgment mappings (per-bucket breakdown)", () => {
    // DevRevThemeProvider is classified "judgment" in primitives.ts.
    // FrameLink is classified "judgment" with equivalent="n/a" in composites.
    // Breakdown buckets count separately; decisionPoints collapses both
    // bucket fires on a single entry into ONE reviewer decision.
    const metrics = computeMetrics(
      m(
        `import { DevRevThemeProvider } from "arcade";
         import { FrameLink } from "arcade-prototypes";`,
      ),
    );
    expect(metrics.judgment).toBe(2);
    expect(metrics.naMappings).toBe(1); // only FrameLink is n/a
    // DevRevThemeProvider (judgment) + FrameLink (judgment+n/a) = 2 distinct
    // entries needing a reviewer decision, not 3.
    expect(metrics.decisionPoints).toBe(2);
  });

  it("collapses judgment + n/a on the same entry to one decision point", () => {
    // ComputerHeader is judgment + n/a. The agent leaves one TODO; the
    // metric should match that reality.
    const metrics = computeMetrics(
      m(`import { ComputerHeader } from "arcade-prototypes";`),
    );
    expect(metrics.judgment).toBe(1); // breakdown still shows the fire
    expect(metrics.naMappings).toBe(1); // breakdown still shows the fire
    expect(metrics.decisionPoints).toBe(1); // but only 1 distinct decision
  });

  it("sums across all buckets", () => {
    const metrics = computeMetrics(
      m(
        `import { TotallyMadeUp } from "arcade";
         import { DevRevThemeProvider } from "arcade";
         import { FrameLink, CanvasPanel } from "arcade-prototypes";`,
      ),
    );
    // unmapped: TotallyMadeUp = 1
    // distinct decision entries: DevRevThemeProvider (judgment) +
    //   FrameLink (judgment+n/a) + CanvasPanel (judgment+n/a) = 3
    // needsReviewerProps: 0 (reserved)
    // iconsAbsorbed: 0 (nothing icon-shaped in this source)
    // Per-bucket breakdown still shows the individual fires:
    //   judgment: 3 (all three entries have the class)
    //   naMappings: 2 (FrameLink + CanvasPanel have source="n/a")
    expect(metrics).toEqual({
      decisionPoints: 4,
      unmapped: 1,
      judgment: 3,
      naMappings: 2,
      needsReviewerProps: 0,
      iconsAbsorbed: 0,
    });
  });
});
