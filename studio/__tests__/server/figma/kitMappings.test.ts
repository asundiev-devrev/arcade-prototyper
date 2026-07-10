import { describe, it, expect } from "vitest";
import { matchKit } from "../../../server/figma/kitMappings";

describe("matchKit cross-generation guard", () => {
  it("does NOT map a set matched only by the generic name 'Button' (could be DLS/deprecated)", () => {
    // No key match; name is the generic 'Button'. Must NOT resolve to a kit component.
    expect(matchKit(undefined, "Button")).toBeNull();
  });

  it("still maps a real Arcade Button by its published set key", () => {
    // The canonical Arcade [0.3] Button key stays mapped via SET_KEY_TO_KIT.
    expect(matchKit("0b87fe4f9790e1c0053da61c767edbaa1c46826d", "Button")).toEqual({
      kind: "component",
      kit: "Button",
    });
  });

  it("still maps detached Icon Button by name (kept — icon-adjacent, low collision risk)", () => {
    expect(matchKit(undefined, "Icon Button")).toEqual({ kind: "component", kit: "IconButton" });
  });
});
