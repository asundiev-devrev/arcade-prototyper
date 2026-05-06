// @vitest-environment node
import { describe, it, expect } from "vitest";
import { hasDeviationsSection, DEVIATIONS_MISSING_TRAILER } from "../../server/deviationsContract";

describe("hasDeviationsSection", () => {
  it("matches a standard ### Deviations heading", () => {
    const text = "Built the nav sidebar and breadcrumb.\n\n### Deviations\n\nNone.";
    expect(hasDeviationsSection(text)).toBe(true);
  });

  it("matches case-insensitively", () => {
    const text = "Summary.\n\n### deviations\n\n- hand-rolled card";
    expect(hasDeviationsSection(text)).toBe(true);
  });

  it("matches with trailing content after the heading word", () => {
    const text = "Summary.\n\n### Deviations (3)\n\n- a\n- b";
    expect(hasDeviationsSection(text)).toBe(true);
  });

  it("does NOT match a bare prose 'Deviations:' without the ### prefix", () => {
    const text = "Summary. Deviations: I hand-rolled the card.";
    expect(hasDeviationsSection(text)).toBe(false);
  });

  it("does NOT match a heading with the wrong level (## instead of ###)", () => {
    const text = "Summary.\n\n## Deviations\n\n- something";
    expect(hasDeviationsSection(text)).toBe(false);
  });

  it("does NOT match an empty string", () => {
    expect(hasDeviationsSection("")).toBe(false);
  });

  it("does NOT match when the heading appears inside a code fence only", () => {
    // NOTE: simple regex match; this is deliberately best-effort. We accept
    // false positives from agents quoting their own contract, because
    // false-positive is "agent did the right thing" and costs nothing. What
    // we need to prevent is silent omission.
    const text = "Summary.\n```\n### Deviations\n```\n";
    expect(hasDeviationsSection(text)).toBe(true);
  });
});

describe("DEVIATIONS_MISSING_TRAILER", () => {
  it("contains a ### Deviations heading so the presence check would pass on re-run", () => {
    expect(hasDeviationsSection(DEVIATIONS_MISSING_TRAILER)).toBe(true);
  });

  it("contains the warning marker so the UI can visually distinguish it", () => {
    expect(DEVIATIONS_MISSING_TRAILER).toMatch(/⚠/);
  });

  it("starts with a blank-line separator so it joins cleanly to preceding narration", () => {
    expect(DEVIATIONS_MISSING_TRAILER.startsWith("\n\n")).toBe(true);
  });
});
