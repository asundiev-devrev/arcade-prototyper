import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs import of a pure-JS module with no types
import { ADS_COLOR_SEED } from "../../../server/figma/adsColorSeed.mjs";

describe("ADS color seed", () => {
  it("carries the expressive-orange family the kit CSS lacks", () => {
    expect(ADS_COLOR_SEED["bg-expressive-orange-subtle"]).toBe("#FCECD2");
  });
  it("keys are normalized kit form (lowercase, hyphenated, no leading --)", () => {
    for (const k of Object.keys(ADS_COLOR_SEED)) {
      expect(k).toMatch(/^[a-z0-9]+(-[a-z0-9]+)+$/); // multi-segment, no slashes/caps/--
    }
  });
  it("values are hex", () => {
    for (const v of Object.values(ADS_COLOR_SEED)) {
      expect(v).toMatch(/^#[0-9A-Fa-f]{6,8}$/);
    }
  });
});
