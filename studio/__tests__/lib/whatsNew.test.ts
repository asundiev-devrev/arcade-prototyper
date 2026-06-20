import { describe, it, expect } from "vitest";
import {
  compareSemver,
  shouldShowWhatsNew,
  extractChangelogSection,
} from "../../src/lib/whatsNew";

describe("compareSemver", () => {
  it("orders by major.minor.patch", () => {
    expect(compareSemver("0.35.1", "0.35.0")).toBeGreaterThan(0);
    expect(compareSemver("0.35.0", "0.35.1")).toBeLessThan(0);
    expect(compareSemver("0.36.0", "0.35.9")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareSemver("0.35.1", "0.35.1")).toBe(0);
  });
  it("treats dev / malformed as 0.0.0", () => {
    expect(compareSemver("0.35.1", "dev")).toBeGreaterThan(0);
    expect(compareSemver("dev", "dev")).toBe(0);
  });
});

describe("shouldShowWhatsNew", () => {
  it("shows on a real upgrade", () => {
    expect(shouldShowWhatsNew("0.35.0", "0.35.1")).toBe(true);
    expect(shouldShowWhatsNew("0.33.0", "0.35.1")).toBe(true);
  });
  it("does NOT show on first-ever launch (no stored version)", () => {
    expect(shouldShowWhatsNew(null, "0.35.1")).toBe(false);
    expect(shouldShowWhatsNew("", "0.35.1")).toBe(false);
  });
  it("does NOT show on same version or downgrade", () => {
    expect(shouldShowWhatsNew("0.35.1", "0.35.1")).toBe(false);
    expect(shouldShowWhatsNew("0.35.1", "0.35.0")).toBe(false);
  });
  it("never shows for a dev / unknown current version", () => {
    expect(shouldShowWhatsNew("0.35.0", "dev")).toBe(false);
    expect(shouldShowWhatsNew("0.35.0", null)).toBe(false);
    expect(shouldShowWhatsNew("0.35.0", undefined)).toBe(false);
  });
});

describe("extractChangelogSection", () => {
  const md = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "## [0.35.1] — 2026-06-16",
    "",
    "### Fixed",
    "- Wire interactions on import.",
    "",
    "## [0.35.0] — 2026-06-15",
    "",
    "### Fixed",
    "- Multi-color titles.",
  ].join("\n");

  it("returns only the requested version's section, with its heading", () => {
    const out = extractChangelogSection(md, "0.35.1");
    expect(out).toContain("## [0.35.1] — 2026-06-16");
    expect(out).toContain("Wire interactions on import.");
    // Must NOT bleed into the next release.
    expect(out).not.toContain("0.35.0");
    expect(out).not.toContain("Multi-color titles.");
  });
  it("returns null when the version isn't in the changelog", () => {
    expect(extractChangelogSection(md, "0.99.0")).toBeNull();
  });
  it("handles the last section (no following heading)", () => {
    const out = extractChangelogSection(md, "0.35.0");
    expect(out).toContain("Multi-color titles.");
    expect(out).not.toContain("[Unreleased]");
  });
});
