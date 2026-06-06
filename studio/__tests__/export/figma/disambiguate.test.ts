// studio/__tests__/export/figma/disambiguate.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveTokenForRole } from "../../../src/export/figma/disambiguate";

const lookup = (v: string): string[] =>
  v === "rgb(23,23,23)" ? ["--bg-neutral-prominent", "--fg-neutral-prominent"]
  : v === "rgb(1,1,1)" ? ["Husk/1200", "--fg-neutral-black"]
  : [];

describe("resolveTokenForRole", () => {
  it("picks the --fg token for a text role (the Slice 0 bug)", () => {
    expect(resolveTokenForRole(lookup, "rgb(23,23,23)", "text")).toBe("--fg-neutral-prominent");
  });

  it("picks the --bg token for a fill role", () => {
    expect(resolveTokenForRole(lookup, "rgb(23,23,23)", "fill")).toBe("--bg-neutral-prominent");
  });

  it("prefers a semantic token over a core color within the survivors", () => {
    expect(resolveTokenForRole(lookup, "rgb(1,1,1)", "text")).toBe("--fg-neutral-black");
  });

  it("falls back to the first candidate when the role filter empties the set", () => {
    const onlyBg = (_: string) => ["--bg-neutral-soft"];
    expect(resolveTokenForRole(onlyBg, "x", "text")).toBe("--bg-neutral-soft");
  });

  it("returns the raw value when there are no candidates", () => {
    expect(resolveTokenForRole(() => [], "rgb(9,9,9)", "fill")).toBe("rgb(9,9,9)");
  });

  // The dominant arcade-gen namespace is component-scoped (--component-*-fg,
  // --button-*-bg, --feedback-fg-*), NOT leading --fg-/--bg-. Role matching must
  // see the fg/bg/stroke SEGMENT anywhere, or these fall through to first-candidate
  // and re-introduce the Slice 0 text-resolved-to-BG bug.
  const componentLookup = (v: string): string[] =>
    v === "#211e20"
      ? ["--component-button-expressive-fg-idle", "--bg-neutral-prominent"]
      : v === "#f5f5f5"
        ? ["--component-bubble-self-bg", "--component-bubble-self-fg"]
        : v === "#ccc"
          ? ["--component-counter-neutral-stroke", "--bg-neutral-soft"]
          : [];

  it("picks a component -fg token for a text role (component namespace)", () => {
    expect(resolveTokenForRole(componentLookup, "#211e20", "text")).toBe(
      "--component-button-expressive-fg-idle",
    );
  });

  it("picks the component -bg token (not -fg) for a fill role", () => {
    expect(resolveTokenForRole(componentLookup, "#f5f5f5", "fill")).toBe(
      "--component-bubble-self-bg",
    );
  });

  it("picks the component -fg token for a text role when both share a value", () => {
    expect(resolveTokenForRole(componentLookup, "#f5f5f5", "text")).toBe(
      "--component-bubble-self-fg",
    );
  });

  it("picks a component -stroke token for a stroke role", () => {
    expect(resolveTokenForRole(componentLookup, "#ccc", "stroke")).toBe(
      "--component-counter-neutral-stroke",
    );
  });
});
