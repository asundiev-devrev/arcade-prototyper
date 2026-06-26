import { describe, it, expect } from "vitest";
import { resolveCustomizeTarget, type OwnerLink } from "../../src/frame/resolveCustomizeTarget";

const KIT = "/p/studio/prototype-kit/dist/composites/ChatMessages.js";
const FRAME = "/p/projects/demo/frames/01-computer/index.tsx";

describe("resolveCustomizeTarget", () => {
  it("returns the outermost in-source component (all-composite frame)", () => {
    // innermost → outermost
    const chain: OwnerLink[] = [
      { componentName: "Agent", file: KIT, line: 480, column: 9 },
      { componentName: "ChatMessages", file: KIT, line: 20, column: 5 },
      { componentName: "ComputerScene", file: FRAME, line: 6, column: 5 },
    ];
    expect(resolveCustomizeTarget(chain, "01-computer")).toEqual({ componentName: "ComputerScene", line: 6, column: 5 });
  });
  it("returns the in-source component nearest the click when it is itself in-source", () => {
    const F = "/p/projects/demo/frames/02-page/index.tsx";
    const chain: OwnerLink[] = [
      { componentName: "Button", file: F, line: 9, column: 7 },
      { componentName: "Card", file: F, line: 8, column: 5 },
    ];
    // outermost in-source = Card (the whole card expands; both are in-source)
    expect(resolveCustomizeTarget(chain, "02-page")).toEqual({ componentName: "Card", line: 8, column: 5 });
  });
  it("returns null when no owner is in the frame source", () => {
    const chain: OwnerLink[] = [{ componentName: "Agent", file: KIT, line: 1, column: 1 }];
    expect(resolveCustomizeTarget(chain, "01-computer")).toBeNull();
  });
  it("ignores a different frame's file", () => {
    const chain: OwnerLink[] = [{ componentName: "X", file: "/p/projects/demo/frames/99-other/index.tsx", line: 1, column: 1 }];
    expect(resolveCustomizeTarget(chain, "01-computer")).toBeNull();
  });
});
