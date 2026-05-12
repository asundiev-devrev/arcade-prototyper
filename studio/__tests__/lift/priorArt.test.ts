// studio/__tests__/lift/priorArt.test.ts
//
// Guards for the prior_art field added in PR 4 of the rules-over-tables
// plan. Two kinds of checks:
//   - Data shape: every prior-art entry uses a sensible relative path.
//   - Render wiring: entries with prior_art emit <prior_art> + <example>;
//     entries without it emit neither element.
//
// The plan commits to a drift audit in PR 5 that will verify each path
// actually exists in devrev-web. That is NOT checked here — this test
// only catches obviously-malformed entries that slip through review.

import { describe, it, expect } from "vitest";
import { buildManifest } from "../../src/lift/buildManifest";
import { renderXml } from "../../src/lift/render";
import { ALL_MAPPINGS } from "../../src/lift/mappings";

describe("prior_art data", () => {
  it("every prior-art path is repo-relative (no leading /, no ../)", () => {
    for (const entry of ALL_MAPPINGS) {
      for (const ex of entry.priorArt ?? []) {
        expect(ex.path, `entry ${entry.studio.name}`).not.toMatch(/^\//);
        expect(ex.path, `entry ${entry.studio.name}`).not.toContain("..");
      }
    }
  });

  it("every prior-art path points under libs/ or apps/", () => {
    // Conservative: the manifest target is devrev-web, and interesting
    // examples live in libs/ (packages) or apps/ (consumer apps). A path
    // outside those roots is almost certainly a typo.
    for (const entry of ALL_MAPPINGS) {
      for (const ex of entry.priorArt ?? []) {
        expect(
          ex.path.startsWith("libs/") || ex.path.startsWith("apps/"),
          `entry ${entry.studio.name}: path ${ex.path}`,
        ).toBe(true);
      }
    }
  });

  it("every prior-art entry has a non-empty `covers` note", () => {
    for (const entry of ALL_MAPPINGS) {
      for (const ex of entry.priorArt ?? []) {
        expect(ex.covers.trim().length, `entry ${entry.studio.name}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("prior_art rendering", () => {
  it("emits <prior_art> + <example> for mappings that have it", () => {
    // SettingsPage carries prior-art entries; the sample frame uses it.
    const rendered = renderXml(
      buildManifest({
        projectSlug: "p",
        frameSlug: "f",
        frameAbsPath: "/f",
        frameSource: `import { SettingsPage } from "arcade-prototypes";`,
        intentSummary: "",
      }),
    );
    expect(rendered).toContain(`<prior_art>`);
    expect(rendered).toMatch(
      /<example path="libs\/settings\/feature\/computer-settings\/src\/pages\/preferences\/preferences-page\.tsx"/,
    );
    expect(rendered).toContain(`</prior_art>`);
  });

  it("omits <prior_art> when the mapping has no entries", () => {
    // Badge is mechanical with no prior-art — rendered output should not
    // carry an empty <prior_art/> element.
    const rendered = renderXml(
      buildManifest({
        projectSlug: "p",
        frameSlug: "f",
        frameAbsPath: "/f",
        frameSource: `import { Badge } from "arcade";`,
        intentSummary: "",
      }),
    );
    expect(rendered).not.toContain(`<prior_art`);
  });
});
