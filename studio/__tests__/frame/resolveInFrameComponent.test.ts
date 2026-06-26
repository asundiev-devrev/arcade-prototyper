// studio/__tests__/frame/resolveInFrameComponent.test.ts
import { describe, it, expect } from "vitest";
import { resolveInFrameComponent, type OwnerLink } from "../../src/frame/resolveInFrameComponent";

const KIT = "/p/studio/prototype-kit/dist/templates/SettingsPage.js";
const FRAME = "/p/projects/demo/frames/01-page/index.tsx";

describe("resolveInFrameComponent", () => {
  it("returns the INNERMOST in-frame component (nested in-source case)", () => {
    // innermost → outermost: Button(in-frame) inside Card(in-frame) inside the page
    const chain: OwnerLink[] = [
      { componentName: "Button", file: FRAME, line: 9, column: 7 },
      { componentName: "Card", file: FRAME, line: 8, column: 5 },
    ];
    expect(resolveInFrameComponent(chain, "01-page")).toEqual({ componentName: "Button", file: FRAME, line: 9, column: 7 });
  });
  it("returns the only in-frame component when the click is deep in a composite", () => {
    // <aside> deep inside SettingsPage: its owners up to SettingsPage are kit; SettingsPage is in-frame
    const chain: OwnerLink[] = [
      { componentName: "SettingsSidebar", file: KIT, line: 12, column: 3 },
      { componentName: "SettingsPage", file: FRAME, line: 7, column: 25 },
    ];
    expect(resolveInFrameComponent(chain, "01-page")).toEqual({ componentName: "SettingsPage", file: FRAME, line: 7, column: 25 });
  });
  it("returns null when no owner is in the frame source", () => {
    const chain: OwnerLink[] = [{ componentName: "X", file: KIT, line: 1, column: 1 }];
    expect(resolveInFrameComponent(chain, "01-page")).toBeNull();
  });
  it("ignores a different frame's file", () => {
    const chain: OwnerLink[] = [{ componentName: "Y", file: "/p/projects/demo/frames/99-other/index.tsx", line: 1, column: 1 }];
    expect(resolveInFrameComponent(chain, "01-page")).toBeNull();
  });
});
