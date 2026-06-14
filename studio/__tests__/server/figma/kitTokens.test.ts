import { describe, it, expect } from "vitest";
import {
  figmaVarNameToKitToken,
  resolveKitTokenVar,
} from "../../../server/figma/kitTokens";

// A small, explicit token set standing in for the kit's tokens.css — keeps the
// assertions independent of the installed @xorkavi/arcade-gen version.
const KIT = new Set([
  "--bg-neutral-soft",
  "--bg-neutral-prominent",
  "--fg-neutral-prominent",
  "--fg-neutral-subtle",
  "--stroke-neutral-subtle",
  "--surface-overlay",
]);

describe("figmaVarNameToKitToken", () => {
  it("flattens a slash-delimited Figma path into the kit's hyphen var name", () => {
    expect(figmaVarNameToKitToken("bg/neutral/soft")).toBe("--bg-neutral-soft");
    expect(figmaVarNameToKitToken("fg/neutral-strong")).toBe("--fg-neutral-strong");
    expect(figmaVarNameToKitToken("surface/default")).toBe("--surface-default");
  });

  it("lowercases and collapses whitespace around slashes", () => {
    expect(figmaVarNameToKitToken("FG / Neutral.Prominent".replace(".", "-")))
      .toBe("--fg-neutral-prominent");
    expect(figmaVarNameToKitToken("Stroke/Neutral/Subtle")).toBe("--stroke-neutral-subtle");
  });
});

describe("resolveKitTokenVar", () => {
  it("emits var() when the bound name maps to a real kit token for the property", () => {
    expect(resolveKitTokenVar("bg/neutral/soft", "background", KIT)).toBe(
      "var(--bg-neutral-soft)",
    );
    expect(resolveKitTokenVar("fg/neutral-prominent", "color", KIT)).toBe(
      "var(--fg-neutral-prominent)",
    );
    expect(resolveKitTokenVar("stroke/neutral-subtle", "stroke", KIT)).toBe(
      "var(--stroke-neutral-subtle)",
    );
  });

  it("falls back (null) when the transformed name is not a kit token", () => {
    // surface/default → --surface-default, which the kit does NOT define
    // (only --surface-overlay here) → must NOT emit a dead var.
    expect(resolveKitTokenVar("surface/default", "background", KIT)).toBeNull();
  });

  it("falls back (null) when the token namespace contradicts the property", () => {
    // The documented bubble bug: a --bg-* token bound to text color. Emitting
    // it as `color` is theme-wrong (flips in dark), so fall back to hex.
    expect(resolveKitTokenVar("bg/neutral/prominent", "color", KIT)).toBeNull();
    // A --fg-* token used for a background is equally a contradiction.
    expect(resolveKitTokenVar("fg/neutral-subtle", "background", KIT)).toBeNull();
  });

  it("accepts a --surface-* token for a background (surface is a bg namespace)", () => {
    expect(resolveKitTokenVar("surface/overlay", "background", KIT)).toBe(
      "var(--surface-overlay)",
    );
  });

  it("returns null for an undefined / unbound name", () => {
    expect(resolveKitTokenVar(undefined, "background", KIT)).toBeNull();
  });
});
